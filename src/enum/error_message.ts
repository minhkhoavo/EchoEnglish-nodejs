/* Định nghĩa các enum lỗi */
export const ErrorMessage = {
   /* User eror */
    USER_EXISTED: { message: "User already existed", status: 400 },
    USER_NOT_FOUND: { message: "User not found", status: 404 },
    ROLE_NOT_FOUND: { message: "Role not found", status: 404 },
    ONLY_UPDATE_YOUR_PROFILE = 'You can only update your own profile',
    UPDATE_USER_FAIL = 'Update user fail',
    DELETE_USER_FAIL = 'Update user fail',
  
    /* Flashcard eror */
    CREATE_FLASHCARD_FAIL = 'Can not create flashcard',
    UPDATE_FLASHCARD_FAIL = 'Update flashcard fail',
    DELETE_FLASHCARD_FAIL = 'Delete flashcard fail',
    FLASHCARD_NOT_FOUND = 'Flashcard not found',
    /* Category error  */
    CATEGORY_NOT_FOUND: { message: "Category not found", status: 404 },
    
    PERMISSION_DENIED = "You don't have permission",
    VALIDATION_ERROR: { message: "Validation error", status: 400 },
    INTERNAL_ERROR: { message: "Internal server error", status: 500 },
    INVALID_ID: { message: "Invalid ID format", status: 400 },
} as const;

export type ErrorMessageKey = keyof typeof ErrorMessage;
