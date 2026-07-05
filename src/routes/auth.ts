import { Router } from 'express';
import AuthenticationController from '~/controllers/authenticationController.js';
import { oneRequestPerSecond } from '~/middleware/rateLimiter.js';

const router = Router();
const authController = new AuthenticationController();

router.post('/register', oneRequestPerSecond, authController.registerUser);
router.post(
    '/verify-register-otp',
    oneRequestPerSecond,
    authController.verifyRegisterOtp
);
router.post(
    '/forgot-password',
    oneRequestPerSecond,
    authController.forgotPassword
);
router.post(
    '/reset-password',
    oneRequestPerSecond,
    authController.resetPassword
);
router.post('/login', oneRequestPerSecond, authController.loginUser);
router.get('/myInfo', authController.getProfile);

export default router;
