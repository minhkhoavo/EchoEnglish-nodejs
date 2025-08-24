import { Schema, InferSchemaType } from "mongoose";

const baseEntitySchema = new Schema(
  {
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
    createBy: {
      type: String,
    },
    updateAt: {
      type: Date,
    },
    updateBy: {
      type: String,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false } // Không tạo _id cho schema lồng
);

export type BaseEntity = InferSchemaType<typeof baseEntitySchema>;
export { baseEntitySchema };

// Middleware để update updateAt trước khi save
export function applyBaseEntityMiddleware(schema: Schema) {
  schema.pre("save", function (next) {
    if (this.isModified()) {
      this.set("updateAt", new Date());
    }
    next();
  });
}
