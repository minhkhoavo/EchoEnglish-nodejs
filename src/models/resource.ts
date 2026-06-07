import mongoose, { Schema, model, Types, InferSchemaType } from 'mongoose';
import { setBaseOptions } from './baseEntity.js';

// Import enum
import { ResourceType } from '../enum/resourceType.js';
import { Style } from '../enum/style.js';
import { Domain } from '../enum/domain.js';

const resourceSchema = new Schema(
    {
        type: {
            type: String,
            enum: Object.values(ResourceType),
            required: [true, 'TYPE_REQUIRED'],
        },

        // URL cho external resources (youtube, web)
        url: { type: String },

        // === Article fields ===
        isArticle: { type: Boolean, default: false },
        attachmentUrl: { type: String }, // S3 Attachment URL
        attachmentName: { type: String },
        isIndexed: { type: Boolean, default: false },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User' },

        // === xAPI fields
        xapiLaunchUrl: { type: String }, // URL public S3 to launch course
        xapiPackageKey: { type: String }, // Prefix S3 include files of the uploaded package

        // === Common fields ===
        title: { type: String },
        thumbnail: { type: String },
        publishedAt: { type: Date },
        lang: { type: String, default: 'en' },
        summary: { type: String },
        content: { type: String }, // HTML content for articles, plain text for web_rss
        keyPoints: [{ type: String }],

        labels: {
            cefr: { type: String },
            style: {
                type: String,
                enum: Object.values(Style),
            },
            domain: {
                type: String,
                enum: Object.values(Domain),
            },
            topic: [{ type: String }],
            genre: { type: String },
            setting: { type: String },
            speechActs: [{ type: String }],
        },

        suitableForLearners: {
            type: Boolean,
            required: [true, 'SUITABLE_FOR_LEARNERS_REQUIRED'],
        },
        moderationNotes: { type: String },
    },
    {
        collection: 'resources',
    }
);

setBaseOptions(resourceSchema);

export type ResourceTypeModel = InferSchemaType<typeof resourceSchema> & {
    _id: Types.ObjectId;
};

export const Resource =
    mongoose.models.Resource ||
    model<ResourceTypeModel>('Resource', resourceSchema);
