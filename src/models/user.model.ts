import { Schema, model, Document } from "mongoose";
import { baseEntityFields, applyBaseEntityMiddleware } from "./baseEntity";
import { Gender } from "~/enum/gender";

export interface IUser extends Document {
  fullName: string;
  gender?: Gender;
  dob?: Date;
  email: string;
  password: string;
  phoneNumber?: string;
  address?: string;
  image?: string;
  roles: string[];
  // baseEntity fields
  createdAt?: Date;
  createBy?: string;
  updateAt?: Date;
  updateBy?: string;
  isDeleted?: boolean;
}

const userSchema = new Schema<IUser>(
  {
    ...baseEntityFields, // thêm các field từ BaseEntity

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
        validator: (value: Date) => {
          if (!value) return true;
          const now = new Date();
          const minAge = 6;
          const age =
            now.getFullYear() -
            value.getFullYear() -
            (now < new Date(now.getFullYear(), value.getMonth(), value.getDate()) ? 1 : 0);
          return age >= minAge;
        },
        message: "DOB_INVALID",
      },
    },
    email: {
      type: String,
      required: [true, "EMAIL_REQUIRED"],
      unique: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "EMAIL_INVALID"],
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
        type: String, // lưu role_name
        ref: "Role",
      },
    ],
  },
  { timestamps: false } // tắt timestamps mặc định vì mình tự định nghĩa trong baseEntityFields
);

// áp dụng middleware để update updateAt khi có thay đổi
applyBaseEntityMiddleware(userSchema);

export const User = model<IUser>("User", userSchema);
