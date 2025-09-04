import {ErrorMessage, ErrorMessageKey} from '../enum/error_message';

/* Custom error */
export class ApiError extends Error{
    public status: number;

    constructor(error: { message: string; status?: number } | ErrorMessageKey){
        if( typeof error === "string"){
            // Nếu truyền vào key như "USER_EXISTED"
            const {message, status} = ErrorMessage[error];
            super(message);
            this.status = status ?? 500; 
        }
        else{
            // Nếu truyền thẳng { message, status }
            super(error.message);
            this.status = error.status ?? 500;
        }

        //giu lai stack trace
        Object.setPrototypeOf(this, ApiError.prototype);
    }
}