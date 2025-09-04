import { Schema, InferSchemaType } from "mongoose";

const baseEntitySchema = new Schema(
  {
    createBy: {
      type: String,
    },
    updateBy: {
      type: String,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false, timestamps: true } // Không tạo _id cho schema lồng
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
