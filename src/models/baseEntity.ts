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
    const userEmail = (this as any)._userEmail;
    if (this.isNew && userEmail) {
      this.set("createBy", userEmail);
    }
    this.set("updateBy", userEmail);
    next();
  });

  schema.pre(["updateOne", "findOneAndUpdate"], function (next: any) {
    const userEmail = (this as any).getOptions().userEmail; 
    if (userEmail) {
      this.set("updateBy", userEmail);
    }
    next();
  });
}
