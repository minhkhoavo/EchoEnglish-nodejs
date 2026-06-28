/* eslint-disable @typescript-eslint/no-explicit-any */
import { promptManagerService } from '~/ai/service/PromptManagerService.js';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('fs/promises', () => ({
    __esModule: true,
    readFile: jest.fn(),
    default: {
        readFile: jest.fn(),
    },
}));

describe('PromptManagerService', () => {
    let consoleErrorSpy: jest.SpyInstance;
    let readFileSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        // Clear the internal Map cache by resetting it via any type casting, or by resetting the service instance if it wasn't a singleton.
        // Since promptManagerService is exported as a singleton, we need to clear its internal cache.
        (promptManagerService as any).promptCache = new Map<string, string>();

        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        // In some Jest ESM setups, spyOn on wildcard imports works better or the mock factory is used.
        readFileSpy = jest.spyOn(fs, 'readFile');
    });

    afterEach(() => {
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
        if (readFileSpy) readFileSpy.mockRestore();
    });

    describe('getTemplate', () => {
        it('should return cached template if exists', async () => {
            (promptManagerService as any).promptCache.set(
                'test-template',
                'cached content'
            );
            const result =
                await promptManagerService.getTemplate('test-template');
            expect(result).toBe('cached content');
            expect(readFileSpy).not.toHaveBeenCalled();
        });

        it('should read speaking template and cache it if not in cache', async () => {
            readFileSpy.mockResolvedValueOnce('speaking template content');
            const result = await promptManagerService.getTemplate('speak-temp');

            expect(result).toBe('speaking template content');
            expect(readFileSpy).toHaveBeenCalledTimes(1);
            expect(readFileSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    path.join('speaking', 'speak-temp.txt')
                ),
                'utf-8'
            );
            expect(
                (promptManagerService as any).promptCache.get('speak-temp')
            ).toBe('speaking template content');
        });

        it('should read writing template and cache it if speaking template fails', async () => {
            // First call throws (speaking fail), second call resolves (writing success)
            readFileSpy.mockRejectedValueOnce(
                new Error('not found in speaking')
            );
            readFileSpy.mockResolvedValueOnce('writing template content');

            const result = await promptManagerService.getTemplate('write-temp');

            expect(result).toBe('writing template content');
            expect(readFileSpy).toHaveBeenCalledTimes(2);
            expect(readFileSpy).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining(
                    path.join('speaking', 'write-temp.txt')
                ),
                'utf-8'
            );
            expect(readFileSpy).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining(path.join('writing', 'write-temp.txt')),
                'utf-8'
            );
            expect(
                (promptManagerService as any).promptCache.get('write-temp')
            ).toBe('writing template content');
        });

        it('should throw Error and log to console if both speaking and writing templates fail', async () => {
            readFileSpy.mockRejectedValue(new Error('not found anywhere'));

            await expect(
                promptManagerService.getTemplate('missing-temp')
            ).rejects.toThrow('Prompt template missing-temp not found.');

            expect(readFileSpy).toHaveBeenCalledTimes(2);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error reading prompt template: missing-temp',
                expect.any(Error)
            );
        });
    });

    describe('loadTemplate', () => {
        it('should return cached template if exists and no variables provided', async () => {
            (promptManagerService as any).promptCache.set(
                'path/to/temp',
                'cached content'
            );
            const result =
                await promptManagerService.loadTemplate('path/to/temp');
            expect(result).toBe('cached content');
            expect(readFileSpy).not.toHaveBeenCalled();
        });

        it('should read from file, replace variables, but NOT cache if variables provided', async () => {
            readFileSpy.mockResolvedValueOnce(
                'Hello {{name}}, welcome to {{place}}.'
            );

            const variables = { name: 'Alice', place: 'Wonderland' };
            const result = await promptManagerService.loadTemplate(
                'path/to/temp2',
                variables
            );

            expect(result).toBe('Hello Alice, welcome to Wonderland.');
            expect(readFileSpy).toHaveBeenCalledTimes(1);
            expect(readFileSpy).toHaveBeenCalledWith(
                expect.stringContaining(path.join('path', 'to', 'temp2.txt')),
                'utf-8'
            );
            expect(
                (promptManagerService as any).promptCache.has('path/to/temp2')
            ).toBe(false);
        });

        it('should read from file, NOT replace anything if variables is missing, and cache it', async () => {
            readFileSpy.mockResolvedValueOnce('Hello static template.');

            const result =
                await promptManagerService.loadTemplate('path/to/temp3');

            expect(result).toBe('Hello static template.');
            expect(
                (promptManagerService as any).promptCache.get('path/to/temp3')
            ).toBe('Hello static template.');
        });

        it('should throw Error and log to console if file reading fails', async () => {
            readFileSpy.mockRejectedValueOnce(new Error('file read error'));

            await expect(
                promptManagerService.loadTemplate('path/missing')
            ).rejects.toThrow('Template path/missing not found.');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error reading template: path/missing',
                expect.any(Error)
            );
        });
    });

    describe('getSystemPrompt', () => {
        it('should read and return system prompt', async () => {
            readFileSpy.mockResolvedValueOnce('system prompt content');

            const result =
                await promptManagerService.getSystemPrompt('sys-prompt-1');

            expect(result).toBe('system prompt content');
            expect(readFileSpy).toHaveBeenCalledTimes(1);
            expect(readFileSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    path.join('systems', 'sys-prompt-1.txt')
                ),
                'utf-8'
            );
        });

        it('should throw Error and log to console if reading system prompt fails', async () => {
            readFileSpy.mockRejectedValueOnce(new Error('sys read error'));

            await expect(
                promptManagerService.getSystemPrompt('sys-missing')
            ).rejects.toThrow('System prompt sys-missing not found.');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error reading system prompt: sys-missing',
                expect.any(Error)
            );
        });
    });
});
