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

    /* Flashcard eror */
    CREATE_FLASHCARD_FAIL: { message: 'Create flashcard fail', status: 400 },
    UPDATE_FLASHCARD_FAIL: { message: 'Update flashcard fail', status: 400 },
    DELETE_FLASHCARD_FAIL: { message: 'Delete flashcard fail', status: 400 },
    FLASHCARD_NOT_FOUND: { message: 'Flashcard not found', status: 404 },
    /* Category error  */
    CATEGORY_NOT_FOUND: { message: 'Category not found', status: 404 },

    PERMISSION_DENIED: { message: "You don't have permission", status: 403 },
    UNAUTHORIZED: { message: 'You are not authorized to view this page', status: 401 },
    VALIDATION_ERROR: { message: 'Validation error', status: 400 },
    INTERNAL_ERROR: { message: 'Internal server error', status: 500 },
    INVALID_ID: { message: 'Invalid ID format', status: 400 },
    NOTFOUND: { message: 'Date not found', status: 404 },
} as const;

export type ErrorMessageKey = keyof typeof ErrorMessage;
