import mongoose from 'mongoose';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

class TestService {
  private async getDb() {
    if (mongoose.connection.readyState !== 1) {
      throw new ApiError(ErrorMessage.INTERNAL_ERROR);
    }
    return mongoose.connection.db!;
  }

  public async getAllTests() {
    const db = await this.getDb();
    const tests = await db
      .collection('tests')
      .find(
        {},
        {
          projection: {
            testId: 1,
            testTitle: 1,
            type: 1,
            number_of_parts: 1,
            number_of_questions: 1,
            duration: 1,
            _id: 0,
          },
        }
      )
      .toArray();
    return tests;
  }

  public async getTestById(testId: string) {
    const db = await this.getDb();
    const test = await db.collection('tests').findOne({ testId: testId });
    if (
      test &&
      (!test.parts || !Array.isArray(test.parts) || test.parts.length === 0)
    ) {
      console.warn(
        '[getTestById] Test found but missing or empty parts:',
        test
      );
    }
    return test;
  }

  public async getTestByPart(testId: string, partNumber: number) {
    const db = await this.getDb();

    const result = await db
      .collection('tests')
      .aggregate([
        { $match: { testId: testId } },
        {
          $project: {
            _id: 1,
            testId: 1,
            testTitle: 1,
            type: 1,
            parts: {
              $filter: {
                input: '$parts',
                as: 'part',
                cond: { $eq: ['$$part.partName', `Part ${partNumber}`] },
              },
            },
          },
        },
      ])
      .toArray();

    if (result.length === 0) {
      return null;
    }

    const test = result[0];
    if (test.parts.length === 0) {
      return null; // Part not found
    }

    return test;
  }
}

export default new TestService();
