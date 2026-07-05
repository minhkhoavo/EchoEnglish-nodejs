import rateLimit from 'express-rate-limit';

export const oneRequestPerSecond = rateLimit({
    windowMs: 100,
    limit: 1,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: 'Too many requests, please slow down and try again.',
    },
});
