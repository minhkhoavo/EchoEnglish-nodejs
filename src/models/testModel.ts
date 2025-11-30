import mongoose, { Schema, Document } from 'mongoose';
import { addBaseFields, setBaseOptions } from './baseEntity.js';

// Option interface
export interface IOption {
    label: string;
    text: string;
}

// Media interface
export interface IMedia {
    audioUrl?: string | null;
    imageUrls?: string[] | null;
    passageHtml?: string | null;
    transcript?: string | null;
    translation?: string | null;
}

// Content Tags interface
export interface IContentTags {
    difficulty?: string;
    style?: string;
    domain?: string[];
    genre?: string[];
    setting?: string[];
}

// Skill Tags interface
export interface ISkillTags {
    part?: string;
    skills?: string[];
    distractorTypes?: string[];
    questionForm?: string;
    question_function?: string;
    responseStrategy?: string;
    skillCategory?: string;
    skillDetail?: string;
    grammarPoint?: string;
    vocabPoint?: string;
    tagType?: string;
    passageType?: string;
    requiresCrossReference?: boolean;
}

// Question interface
export interface IQuestion {
    _id?: mongoose.Types.ObjectId;
    questionNumber: number;
    questionText?: string | null;
    options: IOption[];
    correctAnswer: string;
    explanation?: string;
    media?: IMedia;
    contentTags?: IContentTags;
    skillTags?: ISkillTags;
    groupId?: mongoose.Types.ObjectId;
}

// Question Group interface (for Parts 3, 4, 6, 7)
export interface IQuestionGroup {
    _id?: mongoose.Types.ObjectId;
    groupContext: IMedia;
    questions: IQuestion[];
}

// Part interface
export interface IPart {
    _id?: mongoose.Types.ObjectId;
    partName: string;
    questions?: IQuestion[]; // For Parts 1, 2, 5
    questionGroups?: IQuestionGroup[]; // For Parts 3, 4, 6, 7
}

// Test interface
export interface ITest extends Document {
    testTitle: string;
    type: 'listening-reading';
    duration: number;
    number_of_questions: number;
    number_of_parts: number;
    parts: IPart[];
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

// Option Schema
const OptionSchema = new Schema<IOption>(
    {
        label: { type: String, required: true },
        text: { type: String, default: '' },
    },
    { _id: false }
);

// Media Schema
const MediaSchema = new Schema<IMedia>(
    {
        audioUrl: { type: String, default: null },
        imageUrls: { type: [String], default: null },
        passageHtml: { type: String, default: null },
        transcript: { type: String, default: null },
        translation: { type: String, default: null },
    },
    { _id: false }
);

// Content Tags Schema
const ContentTagsSchema = new Schema<IContentTags>(
    {
        difficulty: { type: String },
        style: { type: String },
        domain: { type: [String] },
        genre: { type: [String] },
        setting: { type: [String] },
    },
    { _id: false }
);

// Skill Tags Schema
const SkillTagsSchema = new Schema<ISkillTags>(
    {
        part: { type: String },
        skills: { type: [String] },
        distractorTypes: { type: [String] },
        questionForm: { type: String },
        question_function: { type: String },
        responseStrategy: { type: String },
        skillCategory: { type: String },
        skillDetail: { type: String },
        grammarPoint: { type: String },
        vocabPoint: { type: String },
        tagType: { type: String },
        passageType: { type: String },
        requiresCrossReference: { type: Boolean },
    },
    { _id: false }
);

// Question Schema
const QuestionSchema = new Schema<IQuestion>({
    questionNumber: { type: Number, required: true },
    questionText: { type: String, default: null },
    options: { type: [OptionSchema], required: true },
    correctAnswer: { type: String, required: true },
    explanation: { type: String },
    media: { type: MediaSchema },
    contentTags: { type: ContentTagsSchema },
    skillTags: { type: SkillTagsSchema },
    groupId: { type: Schema.Types.ObjectId },
});

// Question Group Schema
const QuestionGroupSchema = new Schema<IQuestionGroup>({
    groupContext: { type: MediaSchema, required: true },
    questions: { type: [QuestionSchema], required: true },
});

// Part Schema
const PartSchema = new Schema<IPart>({
    partName: { type: String, required: true },
    questions: { type: [QuestionSchema] },
    questionGroups: { type: [QuestionGroupSchema] },
});

// Test Schema
const TestSchema = new Schema<ITest>({
    testTitle: { type: String, required: true },
    type: {
        type: String,
        enum: ['listening-reading'],
        default: 'listening-reading',
    },
    duration: { type: Number, default: 120 },
    number_of_questions: { type: Number, default: 200 },
    number_of_parts: { type: Number, default: 7 },
    parts: { type: [PartSchema], default: [] },
});

addBaseFields(TestSchema);
setBaseOptions(TestSchema);

const TestModel = mongoose.model<ITest>('Test', TestSchema, 'tests');

export default TestModel;
