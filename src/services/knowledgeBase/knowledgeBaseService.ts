import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { v4 as uuidv4 } from 'uuid';
import { chromaVectorService } from '../document-analyze/chromaService.js';
import { textExtractionService } from '../document-analyze/textExtractionService.js';
import { DocumentChunk } from '../document-analyze/types.js';
import { Resource } from '../../models/resource.js';
import S3Service from '../s3Service.js';

interface IndexArticleParams {
    resourceId: string;
    title: string;
    content: string; // HTML content
    attachmentUrl?: string;
}

interface KnowledgeQueryOptions {
    query: string;
    topK?: number;
}

interface KnowledgeResult {
    content: string;
    resourceId: string;
    title: string;
    score: number;
}

class KnowledgeBaseService {
    private htmlToPlainText(html: string): string {
        if (!html) return '';
        return html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }

    async indexArticle(params: IndexArticleParams): Promise<{
        success: boolean;
        chunksCount: number;
        message: string;
    }> {
        const { resourceId, title, content, attachmentUrl } = params;

        let fullText = '';

        const bodyText = this.htmlToPlainText(content);
        fullText += `${title}\n\n${bodyText}`;

        if (attachmentUrl) {
            try {
                const fileText =
                    await this.extractTextFromAttachment(attachmentUrl);
                if (fileText) {
                    fullText += `\n\n--- Attachment ---\n${fileText}`;
                }
            } catch (error) {
                console.error(
                    '[KnowledgeBase] Failed to extract attachment:',
                    error
                );
            }
        }

        if (!fullText.trim()) {
            return {
                success: false,
                chunksCount: 0,
                message: 'No content to index',
            };
        }

        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 150,
        });
        const documents = await splitter.createDocuments([fullText]);

        const chunks: DocumentChunk[] = documents.map((doc, index) => ({
            id: `${resourceId}_chunk_${index}_${uuidv4()}`,
            content: doc.pageContent,
            metadata: {
                userId: 'system',
                fileId: resourceId,
                fileName: title,
                chunkIndex: index,
                language: 'en',
            },
        }));

        await chromaVectorService.upsertChunks(chunks);
        await Resource.findByIdAndUpdate(resourceId, { isIndexed: true });

        return {
            success: true,
            chunksCount: chunks.length,
            message: `Indexed ${chunks.length} chunks`,
        };
    }

    private async extractTextFromAttachment(url: string): Promise<string> {
        try {
            const fileBuffer = await S3Service.downloadFile(url);
            if (!fileBuffer) return '';

            const urlObj = new URL(url);
            const key = urlObj.pathname.slice(1);
            const ext = key.split('.').pop()?.toLowerCase() || '';

            let mimeType = 'application/octet-stream';
            if (ext === 'pdf') mimeType = 'application/pdf';
            else if (ext === 'docx')
                mimeType =
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            else if (ext === 'txt') mimeType = 'text/plain';

            const fakeFile = {
                buffer: fileBuffer,
                originalname: key,
                mimetype: mimeType,
            } as Express.Multer.File;

            const { text } = await textExtractionService.extractText(fakeFile);
            return text;
        } catch (error) {
            console.error('[KnowledgeBase] extractTextFromAttachment:', error);
            return '';
        }
    }

    async queryKnowledge(
        options: KnowledgeQueryOptions
    ): Promise<KnowledgeResult[]> {
        const { query, topK = 5 } = options;

        const results = await chromaVectorService.query({
            userId: 'system',
            question: query,
            topK,
        });

        if (!results.documents.length) return [];

        return results.documents.map((doc, idx) => {
            const meta = results.metadatas[idx];
            const distance = results.distances[idx] ?? 1;
            return {
                content: doc,
                resourceId: meta.fileId,
                title: meta.fileName,
                score: 1 - distance,
            };
        });
    }

    async getKnowledgeContext(topic: string): Promise<string | null> {
        const results = await this.queryKnowledge({
            query: `English ${topic} explanation examples`,
            topK: 3,
        });

        if (results.length === 0) return null;

        return results
            .map((r) => `--- From "${r.title}" ---\n${r.content}`)
            .join('\n\n');
    }

    async removeFromIndex(resourceId: string): Promise<void> {
        await Resource.findByIdAndUpdate(resourceId, { isIndexed: false });
    }

    async reindexAllArticles(): Promise<{
        total: number;
        success: number;
        failed: number;
    }> {
        const articles = await Resource.find({
            isArticle: true,
            body: { $exists: true, $ne: '' },
        });

        let success = 0;
        let failed = 0;

        for (const article of articles) {
            try {
                await this.indexArticle({
                    resourceId: article._id.toString(),
                    title: article.title || 'Untitled',
                    content: article.content || '',
                    attachmentUrl: article.attachmentUrl,
                });
                success++;
            } catch {
                failed++;
            }
        }

        return { total: articles.length, success, failed };
    }
}

export const knowledgeBaseService = new KnowledgeBaseService();
