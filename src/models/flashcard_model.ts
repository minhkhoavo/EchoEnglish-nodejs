import { Schema, model, InferSchemaType, Types, models } from "mongoose";
import { baseEntitySchema, applyBaseEntityMiddleware, BaseEntity } from "./base_entity";

/* Flashcard model */
const flashcardSchema = new Schema(
  {
    front: {
      type: String,
      required: [true, "FRONT_REQUIRED"],
      trim: true,
    },
    back: {
      type: String,
      required: [true, "BACK_REQUIRED"],
      trim: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "CategoryFlashcard",
      required: [true, "CATEGORY_REQUIRED"],
    },
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      required: [true, "DIFFICULTY_REQUIRED"],
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
  },
  { timestamps: true }
);

flashcardSchema.add(baseEntitySchema.obj);
applyBaseEntityMiddleware(flashcardSchema);

export type FlashcardType = InferSchemaType<typeof flashcardSchema> &
  BaseEntity & { _id: Types.ObjectId };

export const Flashcard = models.Flashcard || model<FlashcardType>("Flashcard", flashcardSchema);
