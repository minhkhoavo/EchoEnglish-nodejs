import mongoose, { Schema, model, InferSchemaType, Types } from 'mongoose';
import { addBaseFields, setBaseOptions } from './baseEntity.js';

export const FILE_DIFFICULTY_LABELS = [
    'CEFR_A1',
    'CEFR_A2',
    'CEFR_B1',
    'CEFR_B2',
    'CEFR_C1',
    'CEFR_C2',
] as const;

export const FILE_STYLE_LABELS = [
    'formal',
    'neutral',
    'informal',
    'technical',
    'narrative',
    'instructional',
] as const;

export const FILE_DOMAIN_LABELS = [
    'business',
    'office',
    'finance',
    'technology',
    'education',
    'healthcare',
    'travel',
    'hospitality',
    'manufacturing',
    'human_resources',
    'marketing',
    'customer_service',
    'logistics',
] as const;

export const FILE_GENRE_LABELS = [
    'email',
    'memo',
    'report',
    'announcement',
    'meeting_minutes',
    'policy',
    'conversation',
    'presentation',
    'article',
    'manual',
] as const;

export const FILE_SETTING_LABELS = [
    'office',
    'meeting_room',
    'conference_call',
    'warehouse',
    'factory_floor',
    'reception',
    'classroom',
    'airport',
    'hotel',
] as const;

const ToeicPartsSchema = new Schema(
    {
        part2: { type: Boolean, default: false },
        part3: { type: Boolean, default: false },
        part4: { type: Boolean, default: false },
        part5: { type: Boolean, default: false },
        part6: { type: Boolean, default: false },
        part7: { type: Boolean, default: false },
    },
    { _id: false }
);

const AiCostSchema = new Schema(
    {
        promptTokens: { type: Number, default: 0 },
        completionTokens: { type: Number, default: 0 },
        totalTokens: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
        currency: { type: String, default: 'USD' },
        model: { type: String, default: '' },
    },
    { _id: false }
);

const ModerationSchema = new Schema(
    {
        status: {
            type: String,
            enum: ['approved', 'flagged', 'rejected'],
            default: 'approved',
        },
        reason: { type: String },
        categories: [{ type: String }],
    },
    { _id: false }
);

const EmbeddingSchema = new Schema(
    {
        collection: { type: String },
        docIds: [{ type: String }],
        chunkCount: { type: Number, default: 0 },
        chunkSize: { type: Number, default: 0 },
        vectorDimension: { type: Number },
        metadata: Schema.Types.Mixed,
    },
    { _id: false }
);

const AnalysisSchema = new Schema(
    {
        difficulty: { type: String, enum: FILE_DIFFICULTY_LABELS },
        style: { type: String, enum: FILE_STYLE_LABELS },
        domain: [{ type: String, enum: FILE_DOMAIN_LABELS }],
        genre: [{ type: String, enum: FILE_GENRE_LABELS }],
        setting: [{ type: String, enum: FILE_SETTING_LABELS }],
        toeicParts: { type: ToeicPartsSchema, default: () => ({}) },
        tokenLength: { type: Number },
        summary: { type: String },
        language: { type: String },
        teachingNotes: { type: String },
        personalizationIdeas: { type: [String], default: [] },
        toeicQuestionIdeas: { type: [String], default: [] },
        additionalMetadata: { type: Schema.Types.Mixed },
    },
    { _id: false }
);

const FileMetadataSchema = new Schema(
    {
        fileName: { type: String, required: true },
        fileType: { type: String, required: true },
        language: { type: String },
        fileSizeKb: { type: Number },
        tagsPart: { type: [String], default: [] },
        status: {
            type: String,
            enum: ['processed', 'flagged', 'failed'],
            default: 'processed',
        },
        s3Url: { type: String, required: true },
        key: { type: String, required: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        uploadTimestamp: { type: Date, default: Date.now },
        docId: { type: String },
        tokenLength: { type: Number },
        metadata: { type: Schema.Types.Mixed },
        toeicParts: { type: ToeicPartsSchema },
        file: { type: Schema.Types.Mixed },
        moderation: { type: ModerationSchema },
        analysis: { type: AnalysisSchema },
        embedding: { type: EmbeddingSchema },
        aiCost: { type: AiCostSchema },
    },
    {
        collection: 'file_metadata',
    }
);

addBaseFields(FileMetadataSchema);
setBaseOptions(FileMetadataSchema);

export type FileMetadataDocument = InferSchemaType<
    typeof FileMetadataSchema
> & {
    _id: Types.ObjectId;
};

export const FileMetadata =
    mongoose.models.FileMetadata ||
    model<FileMetadataDocument>('FileMetadata', FileMetadataSchema);
