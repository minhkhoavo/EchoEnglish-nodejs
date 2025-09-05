import { Schema, InferSchemaType, Types } from "mongoose";

const baseEntitySchema = new Schema(
  {
    createBy: {
      type: String,
    },
    updateBy: {
      type: String ,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false, timestamps: false } // Không tạo _id cho schema lồng
);

export type BaseEntity = InferSchemaType<typeof baseEntitySchema>;
export { baseEntitySchema };

// Middleware để update updateAt trước khi save
export function applyBaseEntityMiddleware(schema: Schema) {
  schema.pre("save", function (next) {
    const userId = (this as any)._userId;
    if (this.isNew && userId) {
      this.set("createBy", userId);
    }
    this.set("updateBy", userId);
    next();
  });

  schema.pre(["updateOne", "findOneAndUpdate"], function (next: any) {
    const userId = (this as any).getOptions().userId; 
    if (userId) {
      this.set("updateBy", userId);
    }
    next();
  });
}
