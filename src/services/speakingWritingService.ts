import mongoose from 'mongoose';
import { ApiError } from '~/middleware/apiError';
import { ErrorMessage } from '~/enum/errorMessage';

class SpeakingWritingService {
  private async getDb() {
    if (mongoose.connection.readyState !== 1) {
      throw new ApiError(ErrorMessage.INTERNAL_ERROR);
    }
    return mongoose.connection.db!;
  }

  public async getAllTests() {
    const db = await this.getDb();
    const tests = await db
      .collection('sw_tests')
      .find({}, { projection: { testId: 1, testTitle: 1, _id: 0 } })
      .toArray();
    return tests;
  }

  public async getTestById(testId: string) {
    const db = await this.getDb();
    const test = await db.collection('sw_tests').findOne({
      testId: parseInt(testId),
    });
    return test;
  }
}

export default new SpeakingWritingService();
