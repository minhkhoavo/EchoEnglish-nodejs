import { Router } from 'express';
import PaymentController from '~/controllers/paymentController.js';
import PromoController from '~/controllers/promoController.js';
import {
    globalAuth,
    hasAuthority,
    isOwn,
} from '~/middleware/authMiddleware.js';
const router = Router();
const promoController = new PromoController();

// Admin tạo promo code
router.post('/', promoController.createPromoCode);

router.get('/', promoController.getAllPromos);
router.get('/:id', promoController.getPromoById);
router.put('/:id', promoController.updatePromo);
router.delete('/:id', promoController.deletePromo);
// Validate promo code
router.get('/validate', promoController.validatePromoCode);

export default router;
