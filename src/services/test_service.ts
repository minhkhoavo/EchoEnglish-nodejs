import mongoose from 'mongoose';

class TestService {
    private async getDb() {
        if (mongoose.connection.readyState !== 1) {
            throw new Error('Database not connected');
        }
        return mongoose.connection.db!;
    }

    public async getAllTests() {
        const db = await this.getDb();
        const tests = await db.collection('tests').find({}, { projection: { testId: 1, testTitle: 1, _id: 0 } }).toArray();
        return tests;
    }

    public async getTestById(testId: string) {
        const db = await this.getDb();
        const test = await db.collection('tests').findOne({ testId: testId });
        return test;
    }
}

export default new TestService();
