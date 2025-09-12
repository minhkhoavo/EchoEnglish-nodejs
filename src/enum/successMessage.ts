export enum SuccessMessage {
    /* user */
    CREATE_USER_SUCCESS = 'Create user successfully',
    UPDATE_USER_SUCCESS = 'Update user successfully',
    NO_DATA_FOUND = 'No data found',
    ACTIVATE_USER_SUCCESS = 'Activate user successfully',
    LOGIN_SUCCESS = 'Login successfully',
    OTP_VERIFIED_SUCCESS = 'OTP verified successfully, account is activated',
    OTP_INVALID_OR_EXPIRED = 'OTP is invalid or has expired',
    OTP_SENT = 'OTP has been sent to your email',
    PASSWORD_RESET_SUCCESS = 'Password has been reset successfully',
    DELETE_USER_SUCCESS = 'Delete user successfully',
    CREATE_FLASHCARD_SUCCESS = 'Create flashcard successfully',
    UPDATE_FLASHCARD_SUCCESS = 'Update flashcard successfully',

    /* global */
    DELETE_SUCCESS = 'Delete success',

    /* category */
    DELETE_CATEGORY_SUCCESS = 'Delete category successfully',

    /* payment */
    CREATE_PAYMENT_SUCCESS = 'Create payment successfully',
    PAYMENT_PENDING = 'Payment is pending',
    PAYMENT_STATUS_SUCCESS = 'Payment is scuccessful',
}
