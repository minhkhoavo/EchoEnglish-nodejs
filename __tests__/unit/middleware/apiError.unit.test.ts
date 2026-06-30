/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

describe('ApiError', () => {
    it('should create an error using string (ErrorMessageKey)', () => {
        const error = new ApiError('INTERNAL_ERROR');
        expect(error.message).toBe(ErrorMessage.INTERNAL_ERROR.message);
        expect(error.status).toBe(ErrorMessage.INTERNAL_ERROR.status);
    });

    it('should create an error using object with status', () => {
        const error = new ApiError({ message: 'Custom error', status: 400 });
        expect(error.message).toBe('Custom error');
        expect(error.status).toBe(400);
    });

    it('should create an error using object without status (fallback to 500)', () => {
        const error = new ApiError({ message: 'Custom error fallback' });
        expect(error.message).toBe('Custom error fallback');
        expect(error.status).toBe(500);
    });

    it('should fallback to 500 if status is undefined in string error (edge case)', () => {
        const original = (ErrorMessage as any).INTERNAL_ERROR;
        (ErrorMessage as any).INTERNAL_ERROR = { message: 'missing status' };
        const error = new ApiError('INTERNAL_ERROR');
        expect(error.status).toBe(500);
        (ErrorMessage as any).INTERNAL_ERROR = original;
    });
});
