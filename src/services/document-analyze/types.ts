import { UploadResult } from '~/services/s3Service.js';
import {
    FILE_DIFFICULTY_LABELS,
    FILE_DOMAIN_LABELS,
    FILE_GENRE_LABELS,
    FILE_SETTING_LABELS,
    FILE_STYLE_LABELS,
    FileMetadataDocument,
} from '~/models/fileContentModel.js';

type ValuesOf<T extends readonly unknown[]> = T[number];

export type DifficultyLabel = ValuesOf<typeof FILE_DIFFICULTY_LABELS>;
export type StyleLabel = ValuesOf<typeof FILE_STYLE_LABELS>;
export type DomainLabel = ValuesOf<typeof FILE_DOMAIN_LABELS>;
export type GenreLabel = ValuesOf<typeof FILE_GENRE_LABELS>;
export type SettingLabel = ValuesOf<typeof FILE_SETTING_LABELS>;

export type ToeicParts = {
    part2: boolean;
    part3: boolean;
    part4: boolean;
    part5: boolean;
    part6: boolean;
    part7: boolean;
};

export interface DocumentChunkMetadata {
    userId: string;
    fileId: string;
    fileName: string;
    chunkIndex: number;
    difficulty?: DifficultyLabel;
    domain?: DomainLabel[];
    language?: string;
}

export interface DocumentChunk {
    id: string;
    content: string;
    metadata: DocumentChunkMetadata;
}

export interface ModerationResult {
    status: 'approved' | 'flagged' | 'rejected';
    reason?: string;
    categories: string[];
}

export interface VocabularyHighlight {
    term: string;
    cefr?: string;
    explanation?: string;
    example?: string;
}

export interface AnalysisResult {
    difficulty: DifficultyLabel;
    style: StyleLabel;
    domain: DomainLabel[];
    genre: GenreLabel[];
    setting: SettingLabel[];
    toeicParts: ToeicParts;
    tokenLength: number;
    summary: string;
    language: string;
    teachingNotes?: string;
    personalizationIdeas: string[];
    toeicQuestionIdeas: string[];
    additionalMetadata?: Record<string, unknown>;
}

export interface EmbeddingRecord {
    collection: string;
    docIds: string[];
    chunkSize: number;
    chunkCount: number;
    vectorDimension?: number;
    metadata?: Record<string, unknown>;
}

export interface FileAIUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    totalCost: number;
    currency: string;
    model: string;
}

export interface FileProcessingContext {
    file: Express.Multer.File;
    folder?: string;
    userId: string;
}

export interface FileProcessingParams extends FileProcessingContext {
    upload: UploadResult;
}

export interface FileProcessingResult {
    upload: UploadResult;
    moderation: ModerationResult;
    analysis?: AnalysisResult;
    embedding?: EmbeddingRecord;
    aiUsage?: FileAIUsage;
    metadata: FileMetadataDocument;
    chunks?: DocumentChunk[];
}

export interface ChatRequestOptions {
    userId: string;
    question: string;
    fileIds?: string[];
    topK?: number;
    language?: string;
}

export interface ChatReference {
    fileId: string;
    fileName: string;
    chunkIndex: number;
    distance: number;
    difficulty?: DifficultyLabel;
    domain?: DomainLabel[];
    language?: string;
    text: string;
}

export interface FileChatResult {
    answer: string;
    references: ChatReference[];
    usage?: FileAIUsage;
}
