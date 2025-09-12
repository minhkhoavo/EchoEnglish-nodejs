import { Router } from "express";
import paymentController from "~/controllers/paymentController";

const router = Router();

router.post("/create", paymentController.createPayment);
router.get("/vnpay/return", paymentController.vnPayReturn);
router.get("/vnpay/ipn", paymentController.vnPayIpn);

export default router;