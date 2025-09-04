/* Định nghĩa các enum lỗi */
export const ErrorMessage = {
   /* User eror */
    USER_EXISTED: { message: "User already existed", status: 400 },
    USER_NOT_FOUND: { message: "User not found", status: 404 },
    ROLE_NOT_FOUND: { message: "Role not found", status: 404 },

    /* Category error  */
    CATEGORY_NOT_FOUND: { message: "Category not found", status: 404 },

    VALIDATION_ERROR: { message: "Validation error", status: 400 },
    INTERNAL_ERROR: { message: "Internal server error", status: 500 },
    INVALID_ID: { message: "Invalid ID format", status: 400 },
} as const;

export type ErrorMessageKey = keyof typeof ErrorMessage;