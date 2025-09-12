import { Express } from "express";
import { Router } from "express";
import PaymentController from "~/controllers/paymentController";
import { globalAuth, hasAuthority, isOwn } from "~/middleware/authMiddleware";
const router = Router();
const paymentController = new PaymentController();

router.get("", paymentController.getTransactions);
router.post("/use-token", paymentController.useToken);


export default router;
