import mongoose, { Schema, model, InferSchemaType, Types } from 'mongoose';
import { baseEntitySchema, BaseEntity } from './baseEntity.js';

/* Category Flashcard Schema */
const categoryFlashcardSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'CATEGORY_NAME_REQUIRED'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    color: {
      type: String,
      default: '#3B82F6',
      validate: {
        validator: function (v: string) {
          return /^#[0-9A-F]{6}$/i.test(v);
        },
        message: 'Color must be a valid hex color code (e.g., #3B82F6)',
      },
    },
    icon: {
      type: String,
      default: '',
      trim: true,
    },
    createBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: false }
);

export type CategoryFlashcardType = InferSchemaType<
  typeof categoryFlashcardSchema
> &
  BaseEntity & { _id: Types.ObjectId };

export const CategoryFlashcard =
  mongoose.models.CategoryFlashcard ||
  model<CategoryFlashcardType>('CategoryFlashcard', categoryFlashcardSchema);
