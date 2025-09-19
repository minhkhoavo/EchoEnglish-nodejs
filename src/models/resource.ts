import { Schema, model, models, Types, InferSchemaType } from "mongoose";
import { baseEntitySchema, applyBaseEntityMiddleware, BaseEntity } from "./baseEntity";

// Import enum
import { ResourceType } from "../enum/resourceType";
import { Style } from "../enum/style";
import { Domain } from "../enum/domain";

const resourceSchema = new Schema(
  {
    type: {
      type: String,
      enum: Object.values(ResourceType),
      required: [true, "TYPE_REQUIRED"],
    },
    url: {
      type: String,
      required: [true, "URL_REQUIRED"],
    },
    title: { type: String },
    publishedAt: { type: Date },
    lang: { type: String, default: "en" },
    summary: { type: String },
    content: { type: String },
    keyPoints: [{ type: String }], //mảng các ý chính

    labels: {
      cefr: { type: String },
      style: {
        type: String,
        enum: Object.values(Style), 
      },
      domain: {
        type: String,
        enum: Object.values(Domain),
      },
      topic: [{ type: String }],
      genre: { type: String }, //thể loại
      setting: { type: String }, //ngữ cảnh
      speechActs: [{ type: String }], //hành vi ngôn ngữ
    },

    suitableForLearners: { //resource có phù hợp cho người học hay không
      type: Boolean,
      required: [true, "SUITABLE_FOR_LEARNERS_REQUIRED"],
    },
    moderationNotes: { type: String },//ghi chú kiểm duyệt
    approved: { type: Boolean, default: false },//đã duyệt chưa
  },
  { timestamps: true }
);

resourceSchema.add(baseEntitySchema.obj);
applyBaseEntityMiddleware(resourceSchema);

export type ResourceTypeModel = InferSchemaType<typeof resourceSchema> &
  BaseEntity & { _id: Types.ObjectId };

export const Resource =
  models.Resource || model<ResourceTypeModel>("Resource", resourceSchema);