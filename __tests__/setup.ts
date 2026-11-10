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
// Exploration randomises one slot on a share of requests; tests that assert exact lists turn
// it off and the exploration tests switch it on explicitly.
process.env.RECSYS_EXPLORE_PCT = '0';
