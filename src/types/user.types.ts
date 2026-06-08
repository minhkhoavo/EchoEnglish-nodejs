import { UserType } from '~/models/userModel.js';
import { Domain } from '~/enum/domain.js';

// Response for all HTTP methods except DELETE
export type UserResponse = Omit<UserType, 'password' | 'isDeleted'>;

export type UserProfileResponse = Omit<UserType, 'password' | 'isDeleted'>;

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

export interface UserPreferences {
    primaryGoal?:
        | 'toeic_preparation'
        | 'career_advancement'
        | 'business_english'
        | 'academic_excellence';
    targetScore?: number;
    targetDate?: Date;

    studyTimePerDay?: number; // 15, 30, 60, 120 minutes
    weeklyStudyDays?: number;
    preferredStudyTime?: 'morning' | 'afternoon' | 'evening' | 'night';
    studyDaysOfWeek?: number[];

    contentInterests?: Domain[];
    currentLevel?:
        | 'beginner'
        | 'intermediate'
        | 'upper_intermediate'
        | 'advanced';
    lastUpdated?: Date;
}

export interface SetUserPreferencesRequest {
    primaryGoal?:
        | 'toeic_preparation'
        | 'career_advancement'
        | 'business_english'
        | 'academic_excellence';
    targetScore?: number;
    targetDate?: Date;
    studyTimePerDay?: number;
    weeklyStudyDays?: number;
    preferredStudyTime?: 'morning' | 'afternoon' | 'evening' | 'night';
    contentInterests?: Domain[];
    currentLevel?:
        | 'beginner'
        | 'intermediate'
        | 'upper_intermediate'
        | 'advanced';
    studyDaysOfWeek?: number[];
}

export interface UserUpdateRequest {
    fullName?: string;
    gender?: string;
    dob?: string;
    phoneNumber?: string;
    address?: string;
    image?: string;
    role?: 'ADMIN' | 'USER';
    credits?: number;
}
