import { Schema, model, InferSchemaType } from "mongoose";

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

export type PermissionType = InferSchemaType<typeof permissionSchema>;
export const Permission = model("Permission", permissionSchema);
