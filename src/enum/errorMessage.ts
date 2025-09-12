import { NOTFOUND } from 'dns';

/* Định nghĩa các enum lỗi */
export const ErrorMessage = {
    /* User eror */
    USER_EXISTED: { message: 'User already existed', status: 400 },
    USER_NOT_FOUND: { message: 'User not found', status: 404 },
    ROLE_NOT_FOUND: { message: 'Role not found', status: 404 },
    ONLY_UPDATE_YOUR_PROFILE: { message: 'You can only update your own profile', status: 403 },
    UPDATE_USER_FAIL: { message: 'Update user fail', status: 400 },
    DELETE_USER_FAIL: { message: 'Delete user fail', status: 400 },
    FULL_NAME_REQUIRED: { message: 'Full name is required', status: 400 },
    EMAIL_REQUIRED: { message: 'Email is required', status: 400 },
    EMAIL_INVALID: { message: 'Email is invalid', status: 400 },
    DOB_INVALID: { message: 'Date of birth is invalid', status: 400 },
    PASSWORD_REQUIRED: { message: 'Password is required', status: 400 },
    PASSWORD_INVALID: { message: 'Password is invalid', status: 400 },
    PHONE_NUMBER_INVALID: { message: 'Phone number is invalid', status: 400 },
    TOKEN_INVALID: { message: 'Token is invalid', status: 400 },
    /* Role eror */

    /* Flashcard eror */
    CREATE_FLASHCARD_FAIL: { message: 'Create flashcard fail', status: 400 },
    UPDATE_FLASHCARD_FAIL: { message: 'Update flashcard fail', status: 400 },
    DELETE_FLASHCARD_FAIL: { message: 'Delete flashcard fail', status: 400 },
    FLASHCARD_NOT_FOUND: { message: 'Flashcard not found', status: 404 },
    FRONT_REQUIRED: { message: 'Front is required', status: 400 },
    BACK_REQUIRED: { message: 'Back is required', status: 400 },
    CATEGORY_REQUIRED: { message: 'Category is required', status: 400 },
    DIFFICULTY_REQUIRED: { message: 'Difficulty is required', status: 400 },
    /* Category error  */
    CATEGORY_NOT_FOUND: { message: 'Category not found', status: 404 },
    CATEGORY_NAME_REQUIRED: { message: 'Category name is required', status: 400 },

    /*Promotion error*/
    PROMOTION_NOT_FOUND: { message: 'Promotion not found', status: 404 },
    CODE_REQUIRED: { message: 'Code is required', status: 400 },
    DISCOUNT_REQUIRED: { message: 'Discount is required', status: 400 },

    /*Payment error*/
    TYPE_REQUIRED: { message: 'Transaction type is required', status: 400 },
    TOKENS_REQUIRED: { message: 'Tokens is required', status: 400 },

    PERMISSION_DENIED: { message: "You don't have permission", status: 403 },
    UNAUTHORIZED: { message: 'You are not authorized to view this page', status: 401 },
    VALIDATION_ERROR: { message: 'Validation error', status: 400 },
    INTERNAL_ERROR: { message: 'Internal server error', status: 500 },
    INVALID_ID: { message: 'Invalid ID format', status: 400 },
    NOTFOUND: { message: 'Date not found', status: 404 },
} as const;

export type ErrorMessageKey = keyof typeof ErrorMessage;
