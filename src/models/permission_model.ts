import { Schema, model, InferSchemaType, Types, models } from "mongoose";

const permissionSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
    },
  },
  { timestamps: true }
);

export type PermissionType = InferSchemaType<typeof permissionSchema> & { _id: Types.ObjectId };
export const Permission = models.Permission || model<PermissionType>("Permission", permissionSchema);
