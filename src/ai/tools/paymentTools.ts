import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import paymentService from '~/services/payment/paymentService.js';
import { PaymentGateway } from '~/enum/paymentGateway.js';

const createPaymentTool = tool(
    async (
        { credits, paymentGateway, description, promoCode },
        config: RunnableConfig
    ) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');
        const ipAddr = '127.0.0.1';
        const request = {
            tokens: credits,
            paymentGateway,
            description,
            promoCode,
        };

        const result = await paymentService.createPayment(
            userId,
            ipAddr,
            request
        );
        return `Payment created: ${JSON.stringify(result)}`;
    },
    {
        name: 'create_payment',
        description: 'Create a new payment for purchasing credits.',
        schema: z.object({
            credits: z.number().min(1),
            paymentGateway: z.enum([
                PaymentGateway.VNPAY,
                PaymentGateway.STRIPE,
            ]),
            description: z.string().optional(),
            promoCode: z.string().optional(),
        }),
    }
);

const getTop5TransactionsTool = tool(
    async (_: object, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');
        const result = await paymentService.getTransactions({
            userId,
            page: 1,
            limit: 5,
        });
        const simplified = result.transaction.map(
            (t: Record<string, unknown>) => ({
                id: String(t._id),
                type: String(t.type),
                tokens: Number(t.tokens),
                amount: Number(t.amount),
                status: String(t.status),
                description: t.description ? String(t.description) : undefined,
                createdAt: String(t.createAt),
            })
        );
        return JSON.stringify({
            transactions: simplified,
            pagination: result.pagination,
        });
    },
    {
        name: 'get_top_5_transactions',
        description: 'Get the top 5 latest transactions for the user.',
        schema: z.object({}),
    }
);

export const paymentTools = [createPaymentTool, getTop5TransactionsTool];

export type PaymentTool = (typeof paymentTools)[number];
