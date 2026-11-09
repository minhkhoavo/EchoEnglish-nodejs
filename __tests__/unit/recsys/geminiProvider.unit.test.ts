/**
 * The Gemini provider WRAPPER, with the LangChain class mocked. This proves our wiring (model
 * name, key lookup, normalisation, error handling) — it does NOT prove the real API call works;
 * that needs a key and is tracked as T3.12.
 */
const embedDocuments = jest.fn();
const ctor = jest.fn();
jest.mock('@langchain/google-genai', () => ({
    GoogleGenerativeAIEmbeddings: class {
        constructor(opts: unknown) {
            ctor(opts);
        }
        embedDocuments = embedDocuments;
    },
}));

import {
    createGeminiProvider,
    providerNameFromEnv,
} from '~/recsys/embeddings/provider.js';

const KEYS = [
    'GENAI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_GENAI_API_KEY',
    'GENAI_EMBEDDING_MODEL',
    'RECSYS_EMBEDDINGS_PROVIDER',
];
beforeEach(() => {
    embedDocuments.mockReset();
    ctor.mockReset();
    for (const k of KEYS) delete process.env[k];
});

describe('createGeminiProvider (mocked client)', () => {
    it('refuses to start without any API key', async () => {
        await expect(createGeminiProvider()).rejects.toThrow(
            /No Gemini API key/
        );
        expect(ctor).not.toHaveBeenCalled();
    });

    it('uses the same model variable and default as the document-analysis service', async () => {
        process.env.GENAI_API_KEY = 'k';
        const p = await createGeminiProvider();
        expect(ctor).toHaveBeenCalledWith({
            apiKey: 'k',
            model: 'gemini-embedding-001',
        });
        expect(p.name).toBe('gemini:gemini-embedding-001');
        process.env.GENAI_EMBEDDING_MODEL = 'some-other-model';
        const q = await createGeminiProvider();
        expect(q.name).toBe('gemini:some-other-model');
    });

    it('accepts any of the three key variables the repo already uses', async () => {
        for (const k of [
            'GENAI_API_KEY',
            'GOOGLE_API_KEY',
            'GOOGLE_GENAI_API_KEY',
        ]) {
            for (const x of KEYS) delete process.env[x];
            process.env[k] = 'key-' + k;
            ctor.mockReset();
            await createGeminiProvider();
            expect(ctor).toHaveBeenCalledWith(
                expect.objectContaining({ apiKey: 'key-' + k })
            );
        }
    });

    it('L2-normalises vectors so cosine == dot product', async () => {
        process.env.GENAI_API_KEY = 'k';
        embedDocuments.mockResolvedValue([
            [3, 4],
            [0, 2],
        ]);
        const out = await (await createGeminiProvider()).embed(['a', 'b']);
        expect(out[0]).toEqual([0.6, 0.8]);
        expect(out[1]).toEqual([0, 1]);
    });

    it('rejects a response whose size does not match the request, or with an empty vector', async () => {
        process.env.GENAI_API_KEY = 'k';
        const p = await createGeminiProvider();
        embedDocuments.mockResolvedValue([[1, 0]]);
        await expect(p.embed(['a', 'b'])).rejects.toThrow(/invalid response/);
        embedDocuments.mockResolvedValue([[1, 0], []]);
        await expect(p.embed(['a', 'b'])).rejects.toThrow(/invalid response/);
    });

    it('propagates API failures (the indexer counts them as a failed batch)', async () => {
        process.env.GENAI_API_KEY = 'k';
        embedDocuments.mockRejectedValue(new Error('429 quota'));
        await expect(
            (await createGeminiProvider()).embed(['a'])
        ).rejects.toThrow('429 quota');
    });
});

describe('provider selection', () => {
    it('names the provider without constructing a client (request-path safe)', () => {
        expect(providerNameFromEnv()).toBe('gemini:gemini-embedding-001');
        process.env.RECSYS_EMBEDDINGS_PROVIDER = 'hash';
        expect(providerNameFromEnv()).toMatch(/^lexical-hash-v1:/);
        expect(ctor).not.toHaveBeenCalled();
    });
});
