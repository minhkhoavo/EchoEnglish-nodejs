import { Router } from 'express';
import paymentController from '~/controllers/paymentController.js';
const router = Router();

router.get('', paymentController.getTransactions);
router.get('/me/credits', paymentController.getCredit);
router.post('/use-token', paymentController.useToken);

/* vnpay */
router.post('/create', paymentController.createPayment);
router.get('/vnpay/return', paymentController.vnPayReturn);
router.get('/vnpay/ipn', paymentController.vnPayIpn);
// Stripe return
router.get('/stripe/return', paymentController.stripeReturn);
router.post('/stripe/webhook', paymentController.stripeWebhook);

// Xem chi tiết giao dịch
router.get('/:id', paymentController.getTransactionById);

export default router;
