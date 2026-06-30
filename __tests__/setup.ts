import dotenv from 'dotenv';

// Mock dotenv.config() globally so it doesn't log during unit tests
jest.mock('dotenv', () => {
    const actual = jest.requireActual('dotenv');
    return {
        ...actual,
        config: jest.fn(),
    };
});

process.env.GOOGLE_API_KEY = 'dummy-key-for-tests';
process.env.CHROMA_API_KEY = 'dummy-key-for-tests';
process.env.CHROMA_TENANT = 'dummy-tenant-for-tests';
process.env.CHROMA_DATABASE = 'dummy-database-for-tests';
