import { UserType } from '~/models/userModel.js';

// Response for all HTTP methods except DELETE
export type UserResponse = Omit<UserType, 'password' | 'isDeleted'>;

export type UserProfileResponse = Omit<
    UserType,
    'password' | 'isDeleted' | 'roles'
>;

export interface UserCreateRequest {
    email: string;
    fullName: string;
    password: string;
    gender: string;
    dob: string;
    phoneNumber?: string;
    address?: string;
    image?: string;
}

export interface UserUpdateRequest {
    fullName?: string;
    gender?: string;
    dob?: string;
    phoneNumber?: string;
    address?: string;
    image?: string;
}
