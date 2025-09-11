import { ErrorMessage, ErrorMessageKey } from '../enum/errorMessage';

/* Custom error */
export class ApiError extends Error {
    public status: number;

    constructor(error: { message: string; status?: number } | ErrorMessageKey) {
        if (typeof error === 'string') {
            const { message, status } = ErrorMessage[error];
            super(message);
            this.status = status ?? 500;
        } else {
            super(error.message);
            this.status = error.status ?? 500;
        }

        Object.setPrototypeOf(this, ApiError.prototype);
    }
}
