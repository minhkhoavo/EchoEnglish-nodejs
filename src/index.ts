import dotenv from 'dotenv';
import express from 'express';
import connectDB from './config/db/configDb';
import apiRouter from './routes';
import { globalAuth } from './middleware/authMiddleware';
import morgan from 'morgan';
import cors from 'cors';
import ErrorMiddleware from './middleware/errorMiddleware';
import paymentController from '~/controllers/paymentController';
import cron from "node-cron";
import resourceService from "./services/transcription/resourceService";


dotenv.config();

const port = process.env.PORT || 4000;
const app = express();

connectDB();

app.use(cors());
app.use(express.json());
app.post(
  '/payments/stripe/webhook',
  express.raw({ type: 'application/json' }),
  paymentController.stripeWebhook
);

cron.schedule("0 0 * * 0", async () => {
  console.log("[CRON] Trigger RSS fetching...");
  await resourceService.fetchAndSaveAllRss();
});

// app.use(morgan('combined'));
app.use(globalAuth);
app.use('/', apiRouter);

app.use(ErrorMiddleware.handleError);
app.listen(port, () => {
  console.log(`App listening on port ${port}`);
  console.log(`Url:   http://localhost:${port}`);
});
