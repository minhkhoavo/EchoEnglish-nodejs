import mongoose from 'mongoose';
import { CategoryFlashcard } from '../../../src/models/categoryFlashcardModel.js';

describe('CategoryFlashcard Model', () => {
    describe('color validator', () => {
        it('should validate hex color code successfully', () => {
            const doc = new CategoryFlashcard({
                name: 'Test',
                color: '#3B82F6',
                createBy: new mongoose.Types.ObjectId(),
            });
            const error = doc.validateSync();
            expect(error).toBeUndefined();
        });

        it('should fail validation on invalid hex color', () => {
            const doc = new CategoryFlashcard({
                name: 'Test',
                color: 'invalid-color',
                createBy: new mongoose.Types.ObjectId(),
            });
            const error = doc.validateSync();
            expect(error).toBeDefined();
            expect(error?.errors['color'].message).toBe(
                'Color must be a valid hex color code (e.g., #3B82F6)'
            );
        });
    });
});
