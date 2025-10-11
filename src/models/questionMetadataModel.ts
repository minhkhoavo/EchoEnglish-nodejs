import mongoose, { Schema, model, Types, InferSchemaType } from 'mongoose';
import { setBaseOptions } from './baseEntity.js';
import { Difficulty } from '../enum/difficulty.js';
import { Domain } from '../enum/domain.js';
import { Genre } from '../enum/genre.js';
import { Setting } from '../enum/setting.js';
import { PartNumber } from '../enum/partNumber.js';

// Content Tags Schema
const contentTagsSchema = new Schema(
    {
        difficulty: {
            type: String,
            enum: Object.values(Difficulty),
            required: true,
        },
        style: {
            type: String,
            required: true,
        },
        domain: [
            {
                type: String,
                enum: Object.values(Domain),
                required: true,
            },
        ],
        genre: [
            {
                type: String,
                enum: Object.values(Genre),
                required: true,
            },
        ],
        setting: [
            {
                type: String,
                enum: Object.values(Setting),
                required: true,
            },
        ],
    },
    { _id: false }
);

// Skill Tags Schema (polymorphic based on part)
const skillTagsSchema = new Schema(
    {
        part: {
            type: String,
            enum: Object.values(PartNumber),
            required: true,
        },

        // Part 1 fields
        skills: [
            {
                type: String,
                enum: [
                    'identifyActionInProgress',
                    'identifyStateCondition',
                    'identifySpatialRelationship',
                ],
            },
        ],
        distractorTypes: [
            {
                type: String,
                enum: ['phoneticSimilarity', 'wrongSubjectVerb'],
            },
        ],

        // Part 2 fields
        questionForm: {
            type: String,
            enum: [
                'whQuestion',
                'yesNo',
                'tagQuestion',
                'statement',
                'alternative',
                'negativeQuestion',
            ],
        },
        questionFunction: {
            type: String,
            enum: [
                'informationSeeking',
                'request',
                'suggestion',
                'offer',
                'opinion',
            ],
        },
        responseStrategy: {
            type: String,
            enum: ['direct', 'indirect'],
        },

        // Part 3 & 4 fields
        skillCategory: {
            type: String,
            enum: ['GIST', 'DETAIL', 'INFERENCE', 'SPECIFIC_ACTION', 'OTHERS'],
        },
        skillDetail: {
            type: String,
            enum: [
                // GIST
                'mainTopic',
                'purpose',
                'problem',
                // DETAIL
                'specificDetail',
                'reasonCause',
                'amountQuantity',
                // INFERENCE
                'inferSpeakerRole',
                'inferLocation',
                'inferImplication',
                'inferFeelingAttitude',
                // SPECIFIC_ACTION
                'futureAction',
                'recommendedAction',
                'requestedAction',
                // OTHERS
                'speakerIntent',
                'connectToGraphic',
            ],
        },

        // Part 5 fields
        grammarPoint: {
            type: String,
            enum: [
                'wordForm',
                'verbTenseMood',
                'subjectVerbAgreement',
                'pronoun',
                'preposition',
                'conjunction',
                'relativeClause',
                'comparativeSuperlative',
                'participle',
            ],
        },
        vocabPoint: {
            type: String,
            enum: ['wordChoice', 'collocation', 'phrasalVerb'],
        },

        // Part 6 fields
        tagType: {
            type: String,
            enum: [
                'grammar',
                'vocabulary',
                'sentenceInsertion',
                'discourseConnector',
            ],
        },

        // Part 7 fields
        passageType: {
            type: String,
            enum: ['single', 'double', 'triple'],
        },
        requiresCrossReference: {
            type: Boolean,
        },
    },
    { _id: false }
);

// Main Question Metadata Schema
const questionMetadataSchema = new Schema(
    {
        questionId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        testId: {
            type: Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        part: {
            type: String,
            enum: Object.values(PartNumber),
            required: true,
            index: true,
        },
        questionNumber: {
            type: Number,
            required: true,
        },
        contentTags: {
            type: contentTagsSchema,
            required: true,
        },
        skillTags: {
            type: skillTagsSchema,
            required: true,
        },
    },
    {
        collection: 'question_metadata',
    }
);

setBaseOptions(questionMetadataSchema);

export type QuestionMetadataType = InferSchemaType<
    typeof questionMetadataSchema
> & {
    _id: Types.ObjectId;
};

export const QuestionMetadata =
    mongoose.models.QuestionMetadata ||
    model<QuestionMetadataType>('QuestionMetadata', questionMetadataSchema);
