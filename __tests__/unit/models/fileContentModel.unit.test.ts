import mongoose from 'mongoose';
import { FileMetadata } from '../../../src/models/fileContentModel.js';

describe('FileContent Model', () => {
    describe('default functions', () => {
        it('should default toeicParts to an empty object', () => {
            const doc = new FileMetadata({
                userId: new mongoose.Types.ObjectId(),
                type: 'document',
                status: 'processed',
                storage: { bucket: 'b', key: 'k', path: 'p', size: 10 },
                analysis: {}, // trigger default toeicParts
            });

            expect(doc.analysis?.toeicParts).toBeDefined();
            expect(doc.analysis?.toeicParts).toMatchObject({
                part2: false,
                part3: false,
            });
        });
    });
});
