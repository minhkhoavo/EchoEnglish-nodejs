/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import express, { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import authRouter from '~/routes/auth.js';
import { User } from '~/models/userModel.js';
import { Role } from '~/models/roleModel.js';
import ErrorMiddleware from '~/middleware/errorMiddleware.js';
import { globalAuth } from '~/middleware/authMiddleware.js';

describe('Authentication Integration Tests', () => {
    let app: Express;
    let mongoServer: MongoMemoryServer;
    let testUser: any;
    let userRole: any;

    beforeAll(async () => {
        // Setup in-memory MongoDB
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        await mongoose.connect(mongoUri);

        // Setup Express app
        app = express();
        app.use(express.json());
        app.use(globalAuth);
        app.use('/auth', authRouter);
        app.use(ErrorMiddleware.handleError);

        // Create default role
        userRole = await Role.create({
            name: 'user',
            description: 'Regular user role',
        });
    }, 60000); // 60 seconds timeout for MongoDB Memory Server setup

    afterAll(async () => {
        await mongoose.disconnect();
        if (mongoServer) {
            await mongoServer.stop();
        }
    }, 60000); // 60 seconds timeout

    beforeEach(async () => {
        // Clear collections before each test
        await User.deleteMany({});

        // Create a test user
        const hashedPassword = await bcrypt.hash('password123', 10);
        testUser = await User.create({
            email: 'test@example.com',
            password: hashedPassword,
            fullName: 'Test User',
            isDeleted: false,
            roles: [userRole._id],
        });
    });

    describe('POST /auth/login', () => {
        it('should login successfully with valid credentials', async () => {
            const response = await request(app)
                .post('/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'password123',
                })
                .expect(200);

            expect(response.body).toHaveProperty('message');
            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveProperty('token');
            expect(response.body.data).toHaveProperty('authenticated', true);
            expect(typeof response.body.data.token).toBe('string');
        });

        it('should return 400 for invalid email format', async () => {
            const response = await request(app)
                .post('/auth/login')
                .send({
                    email: 'invalid-email',
                    password: 'password123',
                })
                .expect(400);

            expect(response.body).toHaveProperty('message');
        });

        it('should return 400 for missing email', async () => {
            const response = await request(app)
                .post('/auth/login')
                .send({
                    password: 'password123',
                })
                .expect(400);

            expect(response.body).toHaveProperty('message');
        });

        it('should return 400 for missing password', async () => {
            const response = await request(app)
                .post('/auth/login')
                .send({
                    email: 'test@example.com',
                })
                .expect(400);

            expect(response.body).toHaveProperty('message');
        });

        it('should return 400 for password less than 8 characters', async () => {
            const response = await request(app)
                .post('/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'short',
                })
                .expect(400);

            expect(response.body).toHaveProperty('message');
        });

        it('should return 404 for non-existent user', async () => {
            const response = await request(app)
                .post('/auth/login')
                .send({
                    email: 'nonexistent@example.com',
                    password: 'password123',
                })
                .expect(404);

            expect(response.body).toHaveProperty('message');
        });

        it('should return 400 for incorrect password', async () => {
            const response = await request(app)
                .post('/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'wrongpassword',
                })
                .expect(400);

            expect(response.body).toHaveProperty('message');
        });

        it('should return 400 for deleted user account', async () => {
            // Mark user as deleted
            await User.findByIdAndUpdate(testUser._id, { isDeleted: true });

            const response = await request(app)
                .post('/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'password123',
                })
                .expect(400);

            expect(response.body).toHaveProperty('message');
        });

        it('should return valid JWT token structure', async () => {
            const response = await request(app)
                .post('/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'password123',
                })
                .expect(200);

            const token = response.body.data.token;
            const parts = token.split('.');

            // JWT should have 3 parts (header.payload.signature)
            expect(parts).toHaveLength(3);
        });

        it('should handle multiple login attempts for same user', async () => {
            const credentials = {
                email: 'test@example.com',
                password: 'password123',
            };

            // First login
            const response1 = await request(app)
                .post('/auth/login')
                .send(credentials)
                .expect(200);

            // Wait a bit to ensure different timestamp
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Second login
            const response2 = await request(app)
                .post('/auth/login')
                .send(credentials)
                .expect(200);

            expect(response1.body.data.token).toBeDefined();
            expect(response2.body.data.token).toBeDefined();
            // Tokens should be different due to timestamp
            expect(response1.body.data.token).not.toBe(
                response2.body.data.token
            );
        });

        it('should login successfully with case-insensitive email', async () => {
            // Email được lowercase trong schema, nên TEST@EXAMPLE.COM sẽ match với test@example.com
            const response = await request(app)
                .post('/auth/login')
                .send({
                    email: 'TEST@EXAMPLE.COM',
                    password: 'password123',
                })
                .expect(200);

            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveProperty('token');
        });
    });

    describe('POST /auth/register', () => {
        it('should send OTP for new user registration', async () => {
            const response = await request(app)
                .post('/auth/register')
                .send({
                    email: 'newuser@example.com',
                    password: 'newpassword123',
                    fullName: 'New User',
                })
                .expect(404); // Returns 404 because OTP needs to be verified

            // Registration creates user but returns 404 waiting for OTP verification
            expect(response.body).toHaveProperty('message');
        });

        it('should return 400 for duplicate email (already registered)', async () => {
            const response = await request(app)
                .post('/auth/register')
                .send({
                    email: 'test@example.com', // Already exists
                    password: 'password123',
                    fullName: 'Test User',
                })
                .expect(400); // Returns 400 for duplicate email

            expect(response.body).toHaveProperty('message');
        });
    });

    describe('GET /auth/myInfo', () => {
        it('should return user profile with valid token', async () => {
            // First login to get token
            const loginResponse = await request(app).post('/auth/login').send({
                email: 'test@example.com',
                password: 'password123',
            });

            const token = loginResponse.body.data.token;

            // Get profile with token
            const response = await request(app)
                .get('/auth/myInfo')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            expect(response.body).toHaveProperty('data');
            expect(response.body.data).toHaveProperty(
                'email',
                'test@example.com'
            );
        });

        it('should return 401 for missing token', async () => {
            await request(app).get('/auth/myInfo').expect(401);
        });

        it('should return 403 for invalid token', async () => {
            await request(app)
                .get('/auth/myInfo')
                .set('Authorization', 'Bearer invalid-token')
                .expect(403); // Returns 403 Forbidden for invalid token
        });
    });
});
