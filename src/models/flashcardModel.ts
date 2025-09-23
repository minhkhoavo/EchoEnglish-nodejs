import mongoose, { Schema, model, InferSchemaType, Types } from 'mongoose';
import { baseEntitySchema, BaseEntity } from './baseEntity.js';

/* Flashcard model */
const flashcardSchema = new Schema(
    {
        front: {
            type: String,
            required: [true, 'FRONT_REQUIRED'],
            trim: true,
        },
        back: {
            type: String,
            required: [true, 'BACK_REQUIRED'],
            trim: true,
        },
        category: {
            type: Schema.Types.ObjectId,
            ref: 'CategoryFlashcard',
            required: [true, 'CATEGORY_REQUIRED'],
        },
        difficulty: {
            type: String,
            enum: ['Easy', 'Medium', 'Hard'],
            required: [true, 'DIFFICULTY_REQUIRED'],
        },
        tags: [
            {
                type: String,
                trim: true,
            },
        ],
        source: {
            type: String,
            trim: true,
        },
        isAIGenerated: {
            type: Boolean,
            default: false,
        },
        createBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    { timestamps: true }
);

export type FlashcardType = InferSchemaType<typeof flashcardSchema> &
    BaseEntity & { _id: Types.ObjectId };

export const Flashcard =
    mongoose.models.Flashcard ||
    model<FlashcardType>('Flashcard', flashcardSchema);
