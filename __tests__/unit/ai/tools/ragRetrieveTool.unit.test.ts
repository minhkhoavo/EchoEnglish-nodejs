/* eslint-disable @typescript-eslint/no-explicit-any */
process.env.CHROMA_API_KEY = 'test';
process.env.CHROMA_TENANT = 'test';
process.env.CHROMA_DATABASE = 'test';
import { chromaVectorService } from '~/services/document-analyze/chromaService.js';

const querySpy = jest.spyOn(chromaVectorService, 'query').mockImplementation();

import { retrieveMyFilesTool } from '~/ai/tools/ragRetrieveTool.js';

describe('ragRetrieveTool', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    const tool = retrieveMyFilesTool as any;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
    });

    it('should throw Error if userId is missing', async () => {
        await expect(tool.invoke({ query: 'test' }, {})).rejects.toThrow(
            'userId required'
        );
    });

    it('should query chroma and return formatted chunks', async () => {
        querySpy.mockResolvedValue({
            documents: ['doc1', 'doc2'],
            metadatas: [{ source: 'file1' }, { source: 'file2' }],
            distances: [0.1, 0.2],
        } as any);

        const result = await tool.invoke(
            { query: 'test', fileIds: ['f1'], topK: 3 },
            { configurable: { userId: 'user-1' } }
        );

        expect(querySpy).toHaveBeenCalledWith({
            userId: 'user-1',
            question: 'test',
            fileIds: ['f1'],
            topK: 3,
        });

        expect(result).toEqual({
            chunks: [
                { text: 'doc1', meta: { source: 'file1' }, distance: 0.1 },
                { text: 'doc2', meta: { source: 'file2' }, distance: 0.2 },
            ],
        });
    });

    it('should use default topK if not provided', async () => {
        querySpy.mockResolvedValue({
            documents: ['doc1'],
            metadatas: [{}],
            distances: [], // distances might be missing, testing fallback ?? 0
        } as any);

        const result = await tool.invoke(
            { query: 'test' },
            { configurable: { userId: 'user-1' } }
        );

        expect(querySpy).toHaveBeenCalledWith({
            userId: 'user-1',
            question: 'test',
            fileIds: undefined,
            topK: 4,
        });

        expect(result.chunks[0].distance).toBe(0);
    });
});
