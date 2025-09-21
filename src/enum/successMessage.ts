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
  GET_SUCCESS = 'Get successfully',
  CREATE_SUCCESS = 'CREATE successfully',
  DELETE_SUCCESS = 'Delete success',

  /* category */
  DELETE_CATEGORY_SUCCESS = 'Delete category successfully',
  /* payment */
  CREATE_PAYMENT_SUCCESS = 'Create payment successfully',
  PAYMENT_PENDING = 'Payment is pending',
  PAYMENT_STATUS_SUCCESS = 'Payment is scuccessful',
  USE_TOKEN_SUCCESS = 'Use token is scuccessful',
  GET_PAYMENT_SUCCESS = 'Get payment is scuccessful',
  DELETE_PROMO_SUCCESS = 'Delete promo is scuccessful',

  /* test */
  GET_ALL_TESTS_SUCCESS = 'Get all tests successfully',
  GET_TEST_BY_ID_SUCCESS = 'Get test by ID successfully',
  GET_TEST_BY_PART_SUCCESS = 'Get test by part successfully',
}
