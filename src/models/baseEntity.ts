import { Schema } from "mongoose";

export const baseEntityFields = {
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
};

// middleware để update updateAt trước khi save
export function applyBaseEntityMiddleware(schema: Schema) {
  schema.pre("save", function (next) {
    if (this.isModified()) {
      this.set("updateAt", new Date());
    }
    next();
  });
}
