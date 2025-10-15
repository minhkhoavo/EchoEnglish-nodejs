/* Định nghĩa các enum lỗi */
export const ErrorMessage = {
    INTERNAL_ERROR: { message: 'Internal server error', status: 500 },
    INVALID_PAGE_LIMIT: { message: 'Invalid page or limit', status: 400 },

    /* User eror */
    USER_EXISTED: { message: 'User already existed', status: 400 },
    USER_NOT_FOUND: { message: 'User not found', status: 404 },
    USER_HAS_BEEN_DELETED: { message: 'User has been deleted', status: 400 },
    USER_PREFERENCE_NOT_FOUND: {
        message: 'User preference not found',
        status: 404,
    },
    ROLE_NOT_FOUND: { message: 'Role not found', status: 404 },
    ONLY_UPDATE_YOUR_PROFILE: {
        message: 'You can only update your own profile',
        status: 403,
    },
    UPDATE_USER_FAIL: { message: 'Update user fail', status: 400 },
    DELETE_USER_FAIL: { message: 'Delete user fail', status: 400 },
    FULL_NAME_REQUIRED: { message: 'Full name is required', status: 400 },
    EMAIL_REQUIRED: { message: 'Email is required', status: 400 },
    EMAIL_INVALID: { message: 'Email is invalid', status: 400 },
    DOB_INVALID: { message: 'Date of birth is invalid', status: 400 },
    PASSWORD_REQUIRED: { message: 'Password is required', status: 400 },
    PASSWORD_INVALID: { message: 'Password is invalid', status: 400 },
    PASSWORD_MUST_BE_8_CHARACTERS: {
        message: 'Password must be at least 8 characters',
        status: 400,
    },
    PHONE_NUMBER_INVALID: { message: 'Phone number is invalid', status: 400 },
    TOKEN_INVALID: { message: 'Token is invalid', status: 400 },
    OTP_INVALID: { message: 'OTP is invalid', status: 400 },
    OTP_EXPIRED: { message: 'OTP is expired', status: 400 },

    /* Role eror */

    /* Flashcard eror */
    FLASHCARD_NOT_FOUND: { message: 'Flashcard not found', status: 404 },
    FRONT_REQUIRED: { message: 'Front is required', status: 400 },
    BACK_REQUIRED: { message: 'Back is required', status: 400 },
    CATEGORY_REQUIRED: { message: 'Category is required', status: 400 },
    DIFFICULTY_REQUIRED: { message: 'Difficulty is required', status: 400 },
    /* Category error  */
    CATEGORY_NOT_FOUND: { message: 'Category not found', status: 404 },
    CATEGORY_NAME_REQUIRED: {
        message: 'Category name is required',
        status: 400,
    },
    CATEGORY_CANNOT_DELETE_DEFAULT: {
        message: 'Cannot delete default category',
        status: 400,
    },

    /*Promotion error*/
    PROMOTION_NOT_FOUND: { message: 'Promotion not found', status: 404 },
    CODE_REQUIRED: { message: 'Code is required', status: 400 },
    DISCOUNT_REQUIRED: { message: 'Discount is required', status: 400 },

    /*Payment error*/
    TYPE_REQUIRED: { message: 'Transaction type is required', status: 400 },
    TOKENS_REQUIRED: { message: 'Tokens is required', status: 400 },
    PAYMENT_STATUS_NOT_FOUND: {
        message: 'PaymentStatus not found',
        status: 404,
    },
    TRANSACTION_TYPE_NOT_FOUND: {
        message: 'TransactionType not found',
        status: 404,
    },
    PAYMENT_GATEWAY_NOT_FOUND: {
        message: 'PaymentGateway not found',
        status: 404,
    },
    INVALID_TOKEN_AMOUNT: { message: 'INVALID TOKEN AMOUNT', status: 404 },
    NOT_ENOUGH_TOKENS: { message: 'NOT ENOUGH TOKENS', status: 404 },
    INVALID_PROMO_DATA: { message: 'INVALID PROMO DATA', status: 400 },
    PROMO_ALREADY_EXISTS: { message: 'PROMO ALREADY EXISTS', status: 400 },
    PROMO_CODE_REQUIRED: { message: 'PROMO CODE REQUIRED', status: 400 },
    PROMO_NOT_FOUND: { message: 'PROMO NOT FOUND', status: 400 },
    PROMO_EXPIRED: { message: 'PROMO EXPIRED', status: 400 },
    PROMO_USAGE_LIMIT_REACHED: {
        message: 'PROMO USAGE LIMIT REACHED',
        status: 400,
    },
    INVALID_DISCOUNT: { message: 'INVALID DISCOUNT', status: 400 },
    INVALID_USAGE_LIMIT: { message: 'INVALID USAGE LIMIT', status: 400 },
    INVALID_ACTIVE: { message: 'INVALID ACTIVE', status: 400 },
    AMOUNT_NOT_MATCH: { message: 'AMOUNT MISMATCH', status: 400 },
    AMOUNT_LIMIT: {
        message: 'The minimum amount for Stripe is $0.50 USD',
        status: 400,
    },
    AMOUNT_INVALID: { message: 'AMOUNT INVALID', status: 400 },

    PAYMENT_FAILED: { message: 'Payment failed', status: 400 },
    SIGNATURE_INVALID: { message: 'Signature is invalid', status: 400 },
    PAYMENT_NOT_FOUND: { message: 'Payment not found', status: 404 },

    PERMISSION_DENIED: { message: "You don't have permission", status: 403 },
    UNAUTHORIZED: {
        message: 'You are not authorized to view this page',
        status: 401,
    },
    PASSWORD_INCORECT: { message: 'Password is incorrect', status: 400 },
    VALIDATION_ERROR: { message: 'Validation error', status: 400 },
    INVALID_ID: { message: 'Invalid ID format', status: 400 },
    NOTFOUND: { message: 'Date not found', status: 404 },

    /* Test error */
    TEST_NOT_FOUND: { message: 'Test not found', status: 404 },
    PART_NOT_FOUND: { message: 'Part not found', status: 404 },

    /*youtube*/
    INVALID_URL_ID_YOUTUBE: { message: 'Invalid YouTube URL', status: 400 },
    YOUTUBE_URL_REQUIRE: { message: 'Youtube url is required', status: 400 },

    /*Resource*/
    RESOURCE_NOT_FOUND: { message: 'Resource not found', status: 404 },
    RESOURCE_ALREADY_EXISTS: {
        message: 'RESOURCE ALREADY EXISTS',
        status: 400,
    },
    SOURCE_REQUIRED: { message: 'Source is required', status: 400 },

    /* Notification */
    NOTIFICATION_ALREADY_MARK: {
        message: 'Notification already marked as read',
        status: 400,
    },
    NOTIFICATION_ALREADY_MARK_ALL: {
        message: 'All notification already marked as read',
        status: 400,
    },
    NOTIFICATION_NOT_FOUND: {
        message: 'Notification not found',
        status: 404,
    },

    /* Translate */
    INVALID_INPUT: {
        message: 'Invalid input data',
        status: 400,
    },
    INPUT_MUST_BE_SINGLE_WORD: {
        message: 'Input must be a single word',
        status: 400,
    },

    /* Writing */
    WRITING_TEST_NOT_FOUND: { message: 'Writing test not found', status: 404 },
    WRITING_TEST_ID_REQUIRED: {
        message: 'Toeic writing test id is required',
        status: 400,
    },
    QUESTION_NUMBER_ANSWER_REQUIRED: {
        message: 'questionNumber and answer are required',
        status: 400,
    },
    ANSWERS_OBJECT_REQUIRED: {
        message: 'answers object is required',
        status: 400,
    },
    RESULT_ID_REQUIRED: { message: 'Result id is required', status: 400 },

    /* Roadmap */
    ROADMAP_NOT_FOUND: { message: 'Roadmap not found', status: 404 },
} as const;

export type ErrorMessageKey = keyof typeof ErrorMessage;
