import { Schema, model, InferSchemaType } from "mongoose";

const roleSchema = new Schema(
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

export type RoleType = InferSchemaType<typeof roleSchema>;
export const Role = model("Role", roleSchema);
