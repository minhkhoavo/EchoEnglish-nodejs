import './roleModel';
import mongoose, { Schema, model, InferSchemaType, Types } from 'mongoose';
import { addBaseFields, setBaseOptions } from './baseEntity.js';
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
        credits: {
            type: Number,
            default: 0,
            min: [0, 'TOKEN_INVALID'],
        },
        preferences: {
            targetScore: { type: Number, min: 10, max: 990 },
            currentScore: { type: Number, min: 10, max: 990 },
            studyTimePerDay: { type: Number, default: 30 },
            preferredStudyTime: {
                type: String,
                enum: ['morning', 'afternoon', 'evening', 'night'],
            },
            targetDate: Date,
            weeklyStudyDays: { type: Number, default: 5, min: 1, max: 7 }, // Số ngày học/tuần
        },
        // User Competency Profile (Dynamic Learning State)
        competencyProfile: {
            currentCEFRLevel: {
                type: String,
                enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
            },
            // Skill Matrix - Tracks proficiency per skill
            skillMatrix: [
                {
                    skill: { type: String, required: true }, // e.g., "inference", "word_form"
                    accuracyHistory: [
                        {
                            value: { type: Number, min: 0, max: 100 },
                            testResultId: Schema.Types.ObjectId,
                            date: { type: Date, default: Date.now },
                        },
                    ],
                    currentAccuracy: { type: Number, min: 0, max: 100 }, // Latest accuracy
                    lastPracticed: Date,
                    proficiency: {
                        type: String,
                        enum: ['weak', 'developing', 'proficient', 'mastered'],
                        default: 'weak',
                    },
                    totalQuestions: { type: Number, default: 0 },
                    correctAnswers: { type: Number, default: 0 },
                },
            ],
            // Domain Proficiency
            domainProficiency: [
                {
                    domain: { type: String, required: true }, // e.g., "finance", "business"
                    accuracy: { type: Number, min: 0, max: 100 },
                    totalQuestions: { type: Number, default: 0 },
                    correctAnswers: { type: Number, default: 0 },
                    lastPracticed: Date,
                },
            ],
            // Score History
            scoreHistory: [
                {
                    testResultId: {
                        type: Schema.Types.ObjectId,
                        ref: 'TestResult',
                    },
                    date: Date,
                    totalScore: Number,
                    listeningScore: Number,
                    readingScore: Number,
                },
            ],

            aiInsights: [
                {
                    title: { type: String, required: true },
                    description: { type: String, required: true },
                    actionText: { type: String },
                    priority: {
                        type: String,
                        enum: ['high', 'medium', 'low'],
                        default: 'medium',
                    },
                    createdAt: { type: Date, default: Date.now },
                },
            ],

            // TOEIC Score Prediction
            scorePrediction: {
                overallScore: { type: Number, min: 10, max: 990 },
                targetScore: { type: Number, min: 10, max: 990 },
                cefrLevel: {
                    type: String,
                    enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
                },
                listeningScore: { type: Number, min: 5, max: 495 },
                readingScore: { type: Number, min: 5, max: 495 },
                summary: { type: String },
                lastUpdated: { type: Date, default: Date.now },
            },

            // 360° Skills Map
            skillsMap: [
                {
                    skillName: { type: String, required: true },
                    percentage: {
                        type: Number,
                        min: 0,
                        max: 100,
                        required: true,
                    },
                    lastUpdated: { type: Date, default: Date.now },
                },
            ],

            lastUpdated: { type: Date, default: Date.now },
        },
    },
    {
        collection: 'users',
    }
);

addBaseFields(userSchema);
setBaseOptions(userSchema);

export type UserType = InferSchemaType<typeof userSchema> & {
    _id: Types.ObjectId;
    isDeleted: boolean;
};

export type UserResponseType = Omit<UserType, 'password'>;
export const User = mongoose.models.User || model<UserType>('User', userSchema);
