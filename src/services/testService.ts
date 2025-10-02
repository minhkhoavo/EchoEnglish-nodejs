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
        console.log('[getAllTests] fetching tests collection');
        const cursor = db.collection('tests').find(
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
        );

        const tests = await cursor.toArray();

        // Debug: log count and sample (safe stringify)
        try {
            console.log('[getAllTests] count:', tests.length);
            if (tests.length > 0) {
                console.log(
                    '[getAllTests] first sample:',
                    JSON.stringify(tests[0], (k, v) => {
                        // Convert ObjectId to hex string for logging
                        if (
                            v &&
                            typeof v === 'object' &&
                            v._bsontype === 'ObjectID'
                        ) {
                            return v.toHexString();
                        }
                        return v;
                    })
                );
            }
        } catch (e) {
            console.warn('[getAllTests] debug log failed', e);
        }

        // Normalize testId to string so API consumers receive consistent type
        const normalized = tests.map((t: Record<string, unknown>) => {
            const out: Record<string, unknown> = { ...t };
            const maybeId = out.testId as unknown;
            // Convert ObjectId-like objects to hex string for API consumers
            if (maybeId && typeof maybeId === 'object') {
                type OidLike = {
                    _bsontype?: string;
                    toHexString?: () => string;
                };
                const asOid = maybeId as OidLike;
                if (
                    asOid._bsontype === 'ObjectID' &&
                    typeof asOid.toHexString === 'function'
                ) {
                    out.testId = asOid.toHexString();
                } else if (
                    maybeId !== undefined &&
                    typeof maybeId !== 'string'
                ) {
                    out.testId = String(maybeId);
                }
            } else if (maybeId !== undefined && typeof maybeId !== 'string') {
                out.testId = String(maybeId);
            }
            return out;
        });

        return Array.isArray(normalized) ? normalized : [];
    }

    public async getTestById(testId: string) {
        const db = await this.getDb();
        // Try multiple query strategies to handle mixed storage types:
        // 1) ObjectId (if the provided id looks like one)
        // 2) numeric (if it's all digits)
        // 3) raw string
        const queries: Array<Record<string, unknown>> = [];
        try {
            if (mongoose.Types.ObjectId.isValid(testId)) {
                queries.push({ testId: new mongoose.Types.ObjectId(testId) });
            }
        } catch {
            // ignore invalid ObjectId creation errors
        }
        if (/^\d+$/.test(testId)) {
            queries.push({ testId: parseInt(testId, 10) });
        }
        queries.push({ testId: testId });

        let found: Record<string, unknown> | null = null;
        for (const q of queries) {
            found = (await db.collection('tests').findOne(q)) as Record<
                string,
                unknown
            > | null;
            if (found) break;
        }

        if (
            found &&
            (!found.parts ||
                !Array.isArray(found.parts) ||
                found.parts.length === 0)
        ) {
            console.warn(
                '[getTestById] Test found but missing or empty parts:',
                found
            );
        }
        return found;
    }

    public async getTestByPart(testId: string, partNumber: number) {
        const db = await this.getDb();

        // Build $match conditions to handle different stored id types
        const matchConditions: Array<Record<string, unknown>> = [];
        try {
            if (mongoose.Types.ObjectId.isValid(testId)) {
                matchConditions.push({
                    testId: new mongoose.Types.ObjectId(testId),
                });
            }
        } catch {
            // ignore invalid ObjectId creation errors
        }
        if (/^\d+$/.test(testId)) {
            matchConditions.push({ testId: parseInt(testId, 10) });
        }
        matchConditions.push({ testId: testId });

        const result = await db
            .collection('tests')
            .aggregate([
                { $match: { $or: matchConditions } },
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
                                cond: {
                                    $eq: [
                                        '$$part.partName',
                                        `Part ${partNumber}`,
                                    ],
                                },
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
