import { Router } from 'express';
import PromoController from '~/controllers/promoController.js';

const router = Router();
const promoController = new PromoController();

// Admin tạo promo code
router.post('', promoController.createPromoCode);

router.get('', promoController.getAllPromos);
router.get('/:id', promoController.getPromoById);
router.put('/:id', promoController.updatePromo);
router.delete('/:id', promoController.deletePromo);
// Validate promo code
router.post('/validate', promoController.validatePromoCode);

export default router;
