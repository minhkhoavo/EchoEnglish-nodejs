import { Express } from "express";
import { Router } from "express";
import PaymentController from "~/controllers/paymentController";
import PromoController from "~/controllers/promoController";
import { globalAuth, hasAuthority, isOwn } from "~/middleware/authMiddleware";
const router = Router();
const promoController = new PromoController();

// Admin tạo promo code
router.post("", promoController.createPromoCode);

// Validate promo code
router.get("/validate", promoController.validatePromoCode);

export default router;
