import { PromptTemplate } from '@langchain/core/prompts';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Types } from 'mongoose';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import {
    FileMetadata,
    type FileMetadataDocument,
} from '~/models/fileContentModel.js';
import {
    AnalysisResult,
    ChatReference,
    ChatRequestOptions,
    DocumentChunk,
    DocumentChunkMetadata,
    FileChatResult,
    FileProcessingParams,
    FileProcessingResult,
} from './types.js';
import { textExtractionService } from './textExtractionService.js';
import { contentModerationService } from './moderationService.js';
import { documentAnalysisService } from './analysisService.js';
import { chromaVectorService } from './chromaService.js';
import {
    extractTextFromMessage,
    composeUsage,
    GeminiUsageResponse,
} from '../../utils/aiUtils.js';
import { v4 as uuidv4 } from 'uuid';

const chatPrompt = new PromptTemplate({
    template: [
        "You are the EchoEnglish TOEIC tutor. Use the supplied context extracted from the learner's documents.",
        'Always answer in the language specified here: {language}. If the context is insufficient, say so and suggest next steps.',
        'Format your reply with three sections:',
        '1. Core explanation',
        '2. TOEIC practice suggestions',
        '3. Vocabulary to watch (if available)',
        '',
        'Context:',
        '{context}',
        '',
        'Learner question: {question}',
        '',
        'Answer ({language}):',
    ].join('\n'),
    inputVariables: ['language', 'context', 'question'],
});

class FileIntelligenceService {
    async processUpload(
        params: FileProcessingParams
    ): Promise<FileProcessingResult> {
        const { file, userId, upload } = params;
        const { text } = await textExtractionService.extractText(file);
        const moderation = await contentModerationService.moderate(text);
        const estimatedTokens = Math.max(
            1,
            Math.round(text.trim().split(/\s+/).length * 1.35)
        );

        const userObjectId = this.resolveUserId(userId);
        const documentId = new Types.ObjectId();

        const metadata = new FileMetadata({
            _id: documentId,
            fileName: upload.originalName ?? file.originalname,
            fileType: upload.mimeType ?? file.mimetype,
            fileSizeKb: Math.round(file.size / 1024),
            tagsPart: [],
            status:
                moderation.status === 'rejected'
                    ? 'failed'
                    : moderation.status === 'flagged'
                      ? 'flagged'
                      : 'processed',
            s3Url: upload.url,
            key: upload.key,
            userId: userObjectId,
            uploadTimestamp: new Date(),
            tokenLength: estimatedTokens,
            file: {
                originalName: file.originalname,
                encoding: file.encoding,
                size: file.size,
            },
            moderation: {
                status: moderation.status,
                reason: moderation.reason,
                categories: moderation.categories,
            },
        });

        let analysis: AnalysisResult | undefined;
        let response: unknown;

        if (moderation.status !== 'rejected') {
            const analysisResult = await this.runAnalysis(text, metadata);
            if (analysisResult) {
                analysis = analysisResult.analysis;
                response = analysisResult.response;
            }
        }
        if (analysis) {
            metadata.analysis = analysis;
            metadata.language = analysis.language;
            metadata.tagsPart = this.toTags(analysis.toeicParts);
            metadata.toeicParts = analysis.toeicParts;
            metadata.tokenLength = analysis.tokenLength;
            const additional: Record<string, unknown> = {
                ...(analysis.additionalMetadata ?? {}),
            };
            metadata.metadata = additional;
        } else {
            metadata.metadata = {};
        }

        let chunks: DocumentChunk[] | undefined;
        if (analysis && moderation.status !== 'rejected') {
            const splitter = new RecursiveCharacterTextSplitter({
                chunkSize: 1100, // approx 220 words * 5 chars/word
                chunkOverlap: 200, // approx 40 words * 5 chars/word
            });
            const documents = await splitter.createDocuments([text]);
            chunks = documents
                .map((doc, index) => ({
                    id: uuidv4(),
                    content: doc.pageContent,
                    metadata: {
                        userId,
                        fileId: documentId.toString(),
                        fileName: metadata.fileName,
                        chunkIndex: index,
                    },
                }))
                .map((chunk) => ({
                    ...chunk,
                    metadata: {
                        ...chunk.metadata,
                        difficulty: analysis?.difficulty,
                        domain: analysis?.domain,
                        language: analysis.language,
                    },
                }));

            try {
                const embeddingInfo =
                    await chromaVectorService.upsertChunks(chunks);
                metadata.embedding = {
                    ...embeddingInfo,
                    metadata: {
                        language: analysis.language,
                        difficulty: analysis.difficulty,
                        domain: analysis.domain,
                    },
                };
                metadata.docId = embeddingInfo.docIds[0] ?? undefined;
            } catch (error) {
                console.error(
                    '[FileIntelligenceService] embedding failed',
                    error
                );
            }
        }
        let aiUsage: ReturnType<typeof composeUsage> | undefined;
        if (response) {
            aiUsage = composeUsage(response as GeminiUsageResponse);
            if (aiUsage) {
                metadata.aiCost = aiUsage;
            }
        }

        await metadata.save();

        return {
            upload,
            moderation,
            analysis,
            embedding: metadata.embedding,
            aiUsage,
            metadata,
            chunks,
        };
    }

    async chat(options: ChatRequestOptions): Promise<FileChatResult> {
        const search = await chromaVectorService.query({
            userId: options.userId,
            question: options.question,
            fileIds: options.fileIds,
            topK: options.topK ?? 4,
        });

        if (!search.documents.length) {
            return {
                answer: 'No matching content found in your uploaded files yet. Try uploading richer documents or ask a more specific question.',
                references: [],
            };
        }

        const contextBlocks = search.documents.map((doc, idx) => {
            const meta = search.metadatas[idx];
            return `Source ${idx + 1} (file: ${meta.fileName}, chunk ${
                meta.chunkIndex + 1
            }): ${doc}`;
        });

        const context = contextBlocks.join('\n\n');

        const detectedLanguage = (
            search.metadatas[0] as DocumentChunkMetadata | undefined
        )?.language;
        const language = options.language ?? detectedLanguage ?? 'en';
        const formattedPrompt = await chatPrompt.format({
            language,
            context,
            question: options.question,
        });

        const model = googleGenAIClient.getModel();
        const responseFromModel = await model.invoke([
            { role: 'user', content: formattedPrompt },
        ]);
        const answer = extractTextFromMessage(responseFromModel);
        const aiUsage = composeUsage(responseFromModel as GeminiUsageResponse);

        const references: ChatReference[] = search.documents.map((doc, idx) => {
            const meta = search.metadatas[idx] as DocumentChunkMetadata;
            const distance = search.distances[idx] ?? 0;
            return {
                fileId: meta.fileId,
                fileName: meta.fileName,
                chunkIndex: meta.chunkIndex,
                distance,
                difficulty: meta.difficulty,
                domain: meta.domain,
                language: meta.language,
                text: doc,
            };
        });

        return { answer, references, usage: aiUsage };
    }

    private resolveUserId(userId: string) {
        if (Types.ObjectId.isValid(userId)) {
            return new Types.ObjectId(userId);
        }
        throw new Error('Invalid user id for file upload');
    }

    private toTags(parts: AnalysisResult['toeicParts']): string[] {
        return Object.entries(parts)
            .filter(([, value]) => value)
            .map(([key]) => `toeic_${key}`);
    }

    private async runAnalysis(
        text: string,
        metadata: FileMetadataDocument
    ): Promise<
        | {
              analysis: AnalysisResult;
              raw: unknown;
              response: unknown; // Gemini response for usage calculation
          }
        | undefined
    > {
        try {
            const analysisResult = await documentAnalysisService.analyze(text);
            return analysisResult;
        } catch (error) {
            console.error('[FileIntelligenceService] analyze failed', error);
            metadata.status = 'failed';
            return undefined;
        }
    }
}

export const fileIntelligenceService = new FileIntelligenceService();
