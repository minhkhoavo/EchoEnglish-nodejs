import "./role_model";
import { Schema, model, InferSchemaType, Types, models  } from "mongoose";
import { baseEntitySchema, applyBaseEntityMiddleware, BaseEntity } from "./base_entity";
import { Gender } from "~/enum/gender";
import { validateDob } from "~/utils/validation/validate";

const userSchema = new Schema(
  {
    fullName: {
      type: String,
      required: [true, "FULL_NAME_REQUIRED"],
      trim: true,
    },
    gender: {
      type: String,
      enum: Object.values(Gender),
      default: Gender.OTHER,
    },
    dob: {
      type: Date,
      validate: {
        validator: validateDob,
        message: "DOB_INVALID",
      },
    },
    email: {
      type: String,
      required: [true, "EMAIL_REQUIRED"],
      unique: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "EMAIL_INVALID"],
    },
    password: {
      type: String,
      required: [true, "PASSWORD_REQUIRED"],
      minlength: [8, "PASSWORD_INVALID"],
      maxlength: [100, "PASSWORD_INVALID"],
    },
    phoneNumber: {
      type: String,
      match: [/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/, "PHONE_NUMBER_INVALID"],
    },
    address: {
      type: String,
    },
    image: {
      type: String,
    },
    roles: [
      {
        type: Schema.Types.ObjectId,
        ref: "Role",
      },
    ],
  },
  { timestamps: false }
);

userSchema.add(baseEntitySchema.obj);

applyBaseEntityMiddleware(userSchema);

export type UserType = InferSchemaType<typeof userSchema> & BaseEntity & {_id: Types.ObjectId;};
export const User =  models.User || model<UserType>("User", userSchema);

