import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

export const mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    tls: {
        ciphers: 'SSLv3',
    },
    logger: true,
    debug: false,
});
