/* eslint-disable @typescript-eslint/no-explicit-any */

// ──────────────────────────────────────────────
// Mock @langchain/google-genai BEFORE importing the module under test
// ──────────────────────────────────────────────
const mockInvoke = jest.fn();
const MockChatGoogleGenerativeAI = jest.fn().mockImplementation(() => ({
    invoke: mockInvoke,
}));

jest.mock('@langchain/google-genai', () => ({
    __esModule: true,
    ChatGoogleGenerativeAI: MockChatGoogleGenerativeAI,
}));

jest.mock('dotenv', () => ({
    __esModule: true,
    default: { config: jest.fn() },
}));

describe('GoogleGenAIClient', () => {
    let GoogleGenAIClient: any;

    beforeAll(async () => {
        process.env.GENAI_API_KEY = 'test-api-key';
        process.env.GEMINI_DEFAULT_MODEL = 'test-default-model';
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ════════════════════════════════════════════
    // Module-level code (apiKey + console.warn)
    // ════════════════════════════════════════════
    describe('module-level apiKey resolution', () => {
        it('should resolve apiKey from GENAI_API_KEY', async () => {
            // Already set in beforeAll
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            GoogleGenAIClient = mod.GoogleGenAIClient;
            expect(GoogleGenAIClient).toBeDefined();
        });

        it('should warn when no apiKey is found', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

            await jest.isolateModulesAsync(async () => {
                const originalGenAi = process.env.GENAI_API_KEY;
                const originalGoogleApi = process.env.GOOGLE_API_KEY;
                const originalGoogleGenAi = process.env.GOOGLE_GENAI_API_KEY;

                delete process.env.GENAI_API_KEY;
                delete process.env.GOOGLE_API_KEY;
                delete process.env.GOOGLE_GENAI_API_KEY;

                await import('~/ai/provider/googleGenAIClient.js');

                expect(warnSpy).toHaveBeenCalledWith(
                    '[ai] No Gemini API key found in GENAI_API_KEY / GOOGLE_API_KEY / GOOGLE_GENAI_API_KEY'
                );

                process.env.GENAI_API_KEY = originalGenAi;
                process.env.GOOGLE_API_KEY = originalGoogleApi;
                process.env.GOOGLE_GENAI_API_KEY = originalGoogleGenAi;
            });
            warnSpy.mockRestore();
        });
    });

    // ════════════════════════════════════════════
    // Constructor
    // ════════════════════════════════════════════
    describe('constructor', () => {
        it('should create ChatGoogleGenerativeAI with defaults when no opts provided', async () => {
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            GoogleGenAIClient = mod.GoogleGenAIClient;

            MockChatGoogleGenerativeAI.mockClear();

            // Delete GEMINI_DEFAULT_MODEL to hit the ?? 'gemini-3.1-flash-lite' fallback
            const originalModel = process.env.GEMINI_DEFAULT_MODEL;
            delete process.env.GEMINI_DEFAULT_MODEL;

            const client = new GoogleGenAIClient();

            expect(MockChatGoogleGenerativeAI).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gemini-3.1-flash-lite',
                    temperature: 0.2,
                    maxRetries: 4,
                })
            );
            expect(client).toBeDefined();

            process.env.GEMINI_DEFAULT_MODEL = originalModel;
        });

        it('should use opts.model when provided', async () => {
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            GoogleGenAIClient = mod.GoogleGenAIClient;

            MockChatGoogleGenerativeAI.mockClear();
            new GoogleGenAIClient({ model: 'custom-model' });

            expect(MockChatGoogleGenerativeAI).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'custom-model',
                })
            );
        });

        it('should use opts.temperature when provided', async () => {
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            GoogleGenAIClient = mod.GoogleGenAIClient;

            MockChatGoogleGenerativeAI.mockClear();
            new GoogleGenAIClient({ temperature: 0.9 });

            expect(MockChatGoogleGenerativeAI).toHaveBeenCalledWith(
                expect.objectContaining({
                    temperature: 0.9,
                })
            );
        });
    });

    // ════════════════════════════════════════════
    // getModel
    // ════════════════════════════════════════════
    describe('getModel', () => {
        it('should return the internal ChatGoogleGenerativeAI model instance', async () => {
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            GoogleGenAIClient = mod.GoogleGenAIClient;

            const client = new GoogleGenAIClient();
            const model = client.getModel();

            expect(model).toBeDefined();
            expect(model.invoke).toBeDefined();
        });
    });

    // ════════════════════════════════════════════
    // generate
    // ════════════════════════════════════════════
    describe('generate', () => {
        it('should return res.output[0].content when res has output array', async () => {
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            GoogleGenAIClient = mod.GoogleGenAIClient;

            mockInvoke.mockResolvedValue({
                output: [{ content: 'output content' }],
            });

            const client = new GoogleGenAIClient();
            const result = await client.generate('test prompt');

            expect(result).toBe('output content');
            expect(mockInvoke).toHaveBeenCalledWith([
                { role: 'user', content: 'test prompt' },
            ]);
        });

        it('should fallback to String(res) when output[0].content is nullish', async () => {
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            GoogleGenAIClient = mod.GoogleGenAIClient;

            const mockRes = {
                output: [{ content: null }],
                toString: () => 'stringified-res',
            };
            mockInvoke.mockResolvedValue(mockRes);

            const client = new GoogleGenAIClient();
            const result = await client.generate('test');

            // null ?? String(res) = 'stringified-res'
            expect(result).toBe('stringified-res');
        });

        it('should return res.text when no output array', async () => {
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            GoogleGenAIClient = mod.GoogleGenAIClient;

            mockInvoke.mockResolvedValue({
                text: 'text content',
            });

            const client = new GoogleGenAIClient();
            const result = await client.generate('test');

            expect(result).toBe('text content');
        });

        it('should return res.content when no output array and no text', async () => {
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            GoogleGenAIClient = mod.GoogleGenAIClient;

            mockInvoke.mockResolvedValue({
                content: 'content field',
            });

            const client = new GoogleGenAIClient();
            const result = await client.generate('test');

            expect(result).toBe('content field');
        });

        it('should return String(res) when no output, text, or content', async () => {
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            GoogleGenAIClient = mod.GoogleGenAIClient;

            const mockRes = { toString: () => 'fallback-string' };
            mockInvoke.mockResolvedValue(mockRes);

            const client = new GoogleGenAIClient();
            const result = await client.generate('test');

            expect(result).toBe('fallback-string');
        });

        it('should return String(res) when try block throws (catch branch)', async () => {
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            GoogleGenAIClient = mod.GoogleGenAIClient;

            // Create a response where accessing .output throws an error
            const mockRes = {
                get output() {
                    // Return a truthy array-like to pass Array.isArray check
                    return Object.defineProperty([{}], '0', {
                        get() {
                            throw new Error('property access error');
                        },
                    });
                },
                toString: () => 'catch-fallback',
            };
            mockInvoke.mockResolvedValue(mockRes);

            const client = new GoogleGenAIClient();
            const result = await client.generate('test');

            expect(result).toBe('catch-fallback');
        });

        it('should handle empty output array (res.output.length = 0)', async () => {
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            GoogleGenAIClient = mod.GoogleGenAIClient;

            mockInvoke.mockResolvedValue({
                output: [],
                text: 'fallback-text',
            });

            const client = new GoogleGenAIClient();
            const result = await client.generate('test');

            // output is [] → length = 0 → falsy → skip to text
            expect(result).toBe('fallback-text');
        });
    });

    // ════════════════════════════════════════════
    // Singleton export (googleGenAIClient)
    // ════════════════════════════════════════════
    describe('singleton googleGenAIClient', () => {
        it('should export a singleton instance', async () => {
            const mod = await import('~/ai/provider/googleGenAIClient.js');
            expect(mod.googleGenAIClient).toBeDefined();
            expect(mod.googleGenAIClient).toBeInstanceOf(mod.GoogleGenAIClient);
        });
    });
});
