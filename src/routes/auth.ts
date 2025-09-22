import { Express } from 'express';
import { Router } from 'express';
import AuthenticationController from '~/controllers/authenticationController.js';

const router = Router();
const authController = new AuthenticationController();

router.post('/register', authController.registerUser);
router.post('/verify-register-otp', authController.verifyRegisterOtp);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/login', authController.loginUser);
router.get('/myInfo', authController.getProfile);

export default router;
