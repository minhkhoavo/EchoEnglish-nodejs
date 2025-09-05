import { Schema, model, InferSchemaType, Types, models } from "mongoose";
import { baseEntitySchema, applyBaseEntityMiddleware, BaseEntity } from "./base_entity";


/* Category Flashcard Schema */
const categoryFlashcardSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "CATEGORY_NAME_REQUIRED"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
  },
  { timestamps: false }
);

// thêm base entity
categoryFlashcardSchema.add(baseEntitySchema.obj);
applyBaseEntityMiddleware(categoryFlashcardSchema);

export type CategoryFlashcardType = InferSchemaType<typeof categoryFlashcardSchema> &
  BaseEntity & { _id: Types.ObjectId };

export const CategoryFlashcard =
  models.CategoryFlashcard || model<CategoryFlashcardType>("CategoryFlashcard", categoryFlashcardSchema);
