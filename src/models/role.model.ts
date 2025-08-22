import { Schema, model, Document } from "mongoose";

export interface IRole extends Document {
  name: string; // role name (primary key)
  description?: string;
  permissions: string[]; // permission_name[]
}

const roleSchema = new Schema<IRole>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
    },
    permissions: [
      {
        type: String,
        ref: "Permission", // join qua permission.name
      },
    ],
  },
  { timestamps: true }
);

export const Role = model<IRole>("Role", roleSchema);
