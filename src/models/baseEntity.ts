import { Schema, InferSchemaType, Types } from 'mongoose';

const baseEntitySchema = new Schema(
  {
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false, timestamps: false }
);

export type BaseEntity = InferSchemaType<typeof baseEntitySchema>;
export { baseEntitySchema };
