import { model, Schema } from 'mongoose';
import { BaseEntity } from './baseEntity';

interface IUserAnswer {
  questionNumber: number;
  selectedAnswer: string; // A, B, C, D
  isCorrect: boolean;
  correctAnswer: string;
}

interface ITestResult extends BaseEntity {
  userId: Schema.Types.ObjectId;
  testId: string;
  testTitle: string;
  testType: string; // 'listening-reading', 'speaking', 'writing'
  duration: number; // in milliseconds
  completedAt: Date;
  score: number; // number of correct answers
  totalQuestions: number;
  userAnswers: IUserAnswer[];
  parts: string[]; // which parts were included in this test
}

const userAnswerSchema = new Schema<IUserAnswer>({
  questionNumber: {
    type: Number,
    required: true,
  },
  selectedAnswer: {
    type: String,
    required: true,
  },
  isCorrect: {
    type: Boolean,
    required: true,
  },
  correctAnswer: {
    type: String,
    required: true,
  },
});

const testResultSchema = new Schema<ITestResult>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    testId: {
      type: String,
      required: true,
    },
    testTitle: {
      type: String,
      required: true,
    },
    testType: {
      type: String,
      required: true,
      enum: ['listening-reading', 'speaking', 'writing'],
    },
    duration: {
      type: Number,
      required: true,
    },
    completedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    score: {
      type: Number,
      required: true,
    },
    totalQuestions: {
      type: Number,
      required: true,
    },
    userAnswers: [userAnswerSchema],
    parts: [
      {
        type: String,
        required: true,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
testResultSchema.index({ userId: 1, completedAt: -1 });
testResultSchema.index({ testId: 1 });

export const TestResult = model<ITestResult>('TestResult', testResultSchema);
export type { ITestResult, IUserAnswer };
