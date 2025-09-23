import dotenv from 'dotenv';
import express from 'express';
import connectDB from './config/db/configDb.js';
import apiRouter from '~/routes/index.js';
import { globalAuth } from './middleware/authMiddleware.js';
import morgan from 'morgan';
import cors from 'cors';
import ErrorMiddleware from './middleware/errorMiddleware.js';
import paymentController from '~/controllers/paymentController.js';
import cron from 'node-cron';
import resourceService from './services/transcription/resourceService.js';
import paymentService from './services/payment/paymentService.js';

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

cron.schedule('0 0 * * 0', async () => {
    console.log('[CRON] Trigger RSS fetching...');
    await resourceService.fetchAndSaveAllRss();
});

cron.schedule('*/1 * * * *', async () => {
    console.log('[CRON] Trigger Check Payment Expired fetching...');
    await paymentService.triggerExpiredPayment();
});

// app.use(morgan('combined'));
app.use(globalAuth);
app.use('/', apiRouter);

app.use(ErrorMiddleware.handleError);
app.listen(port, () => {
    console.log(`App listening on port ${port}`);
    console.log(`Url:   http://localhost:${port}`);
});
