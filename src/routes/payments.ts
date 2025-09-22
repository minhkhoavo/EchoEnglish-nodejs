import { Express } from "express";
import { Router } from "express";
import paymentController from "~/controllers/paymentController.js";
import { globalAuth, hasAuthority, isOwn } from "~/middleware/authMiddleware.js";
const router = Router();

router.get("", paymentController.getTransactions);
router.post("/use-token", paymentController.useToken);

/* vnpay */
router.post("/create", paymentController.createPayment);
router.get("/vnpay/return", paymentController.vnPayReturn);
router.get("/vnpay/ipn", paymentController.vnPayIpn);

// Xem chi tiết giao dịch
router.get("/:id", paymentController.getTransactionById);


export default router;
