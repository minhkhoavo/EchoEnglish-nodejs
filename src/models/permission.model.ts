import { Schema, model, Document } from "mongoose";

export interface IPermission extends Document {
  name: string; // permission name (primary key)
  description?: string;
}

const permissionSchema = new Schema<IPermission>(
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

export const Permission = model<IPermission>("Permission", permissionSchema);
