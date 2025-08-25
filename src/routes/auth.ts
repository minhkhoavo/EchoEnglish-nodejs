import { Express } from "express";
import { Router } from "express";
import AuthenticationController from "~/controllers/AuthenticationController";

// Các route của user
const router = Router();
const authController = new AuthenticationController();

router.post('/register',authController.registerUser); // Đăng ký user
router.post('/verify-register-otp',authController.verifyRegisterOtp); // Xác thực OTP đăng ký
router.post('/forgot-password',authController.forgotPassword); // Quên mật khẩu
router.post('/reset-password',authController.resetPassword); // Đặt lại mật khẩu
router.post('/login', authController.loginUser);
router.get('/myInfo', authController.getProfile);

export default router;