import './roleModel';
import mongoose, { Schema, model, InferSchemaType, Types } from 'mongoose';
import { baseEntitySchema, BaseEntity } from './baseEntity.js';
import { Gender } from '~/enum/gender.js';
import { validateDob } from '~/utils/validation/validate.js';

const userSchema = new Schema(
    {
        fullName: {
            type: String,
            required: [true, 'FULL_NAME_REQUIRED'],
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
                message: 'DOB_INVALID',
            },
        },
        email: {
            type: String,
            required: [true, 'EMAIL_REQUIRED'],
            unique: true,
            lowercase: true,
            match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'EMAIL_INVALID'],
        },
        password: {
            type: String,
            required: [true, 'PASSWORD_REQUIRED'],
            minlength: [8, 'PASSWORD_INVALID'],
            maxlength: [100, 'PASSWORD_INVALID'],
        },
        phoneNumber: {
            type: String,
            match: [/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/, 'PHONE_NUMBER_INVALID'],
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
                ref: 'Role',
            },
        ],
        tokens: {
            type: Number,
            default: 0,
            min: [0, 'TOKEN_INVALID'],
        },
    },
    { timestamps: false }
);

userSchema.add(baseEntitySchema.obj);

export type UserType = InferSchemaType<typeof userSchema> & BaseEntity & { _id: Types.ObjectId };
export type UserResponseType = Omit<UserType, 'password'>;
export type UserUpdateResponseType = {
    id: Types.ObjectId;
    fullName: string;
    gender: string;
    dob: Date | null;
    email: string;
    phoneNumber: string | null;
    address: string | null;
    image: string | null;
    roles: Types.ObjectId[];
    createBy: Types.ObjectId | null;
    updateBy: Types.ObjectId | null;
};
export const User = mongoose.models.User || model<UserType>('User', userSchema);
