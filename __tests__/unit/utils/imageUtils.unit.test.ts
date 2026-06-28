/* eslint-disable @typescript-eslint/no-explicit-any */
import { imageUrlToDataUrl } from '~/utils/imageUtils.js';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('fs/promises', () => ({
    readFile: jest.fn(),
}));

// Mock global fetch
const globalFetchMock = jest.fn();
global.fetch = globalFetchMock;

describe('imageUtils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('imageUrlToDataUrl', () => {
        it('should throw if imageUrl is empty', async () => {
            await expect(imageUrlToDataUrl('')).rejects.toThrow(
                'Empty imageUrl'
            );
            await expect(imageUrlToDataUrl(undefined as any)).rejects.toThrow(
                'Empty imageUrl'
            );
        });

        it('should return imageUrl if it starts with data:', async () => {
            const dataUrl = 'data:image/png;base64,iVBORw0KGgo';
            const result = await imageUrlToDataUrl(dataUrl);
            expect(result).toBe(dataUrl);
        });

        describe('HTTP URLs', () => {
            it('should fetch image and use content-type header', async () => {
                globalFetchMock.mockResolvedValue({
                    ok: true,
                    arrayBuffer: jest
                        .fn()
                        .mockResolvedValue(new ArrayBuffer(8)),
                    headers: new Headers({ 'content-type': 'image/jpeg' }),
                });

                const result = await imageUrlToDataUrl(
                    'https://example.com/img.jpg'
                );
                expect(result).toMatch(/^data:image\/jpeg;base64,/);
                expect(globalFetchMock).toHaveBeenCalledWith(
                    'https://example.com/img.jpg'
                );
            });

            it('should fallback to mimeFromExt if content-type header is missing', async () => {
                globalFetchMock.mockResolvedValue({
                    ok: true,
                    arrayBuffer: jest
                        .fn()
                        .mockResolvedValue(new ArrayBuffer(8)),
                    headers: new Headers(), // No content-type
                });

                const result = await imageUrlToDataUrl(
                    'http://example.com/img.png'
                );
                expect(result).toMatch(/^data:image\/png;base64,/);
            });

            it('should throw if fetch fails', async () => {
                globalFetchMock.mockResolvedValue({
                    ok: false,
                    status: 404,
                });

                await expect(
                    imageUrlToDataUrl('https://example.com/not-found.jpg')
                ).rejects.toThrow('Failed to fetch image: 404');
            });
        });

        describe('Local Files', () => {
            it('should read absolute local file and determine mime', async () => {
                (fs.readFile as jest.Mock).mockResolvedValue(
                    Buffer.from('testdata')
                );
                const result = await imageUrlToDataUrl(
                    '/absolute/path/to/img.gif'
                );
                expect(result).toMatch(/^data:image\/gif;base64,/);
                expect(fs.readFile).toHaveBeenCalledWith(
                    '/absolute/path/to/img.gif'
                );
            });

            it('should resolve relative local file and determine mime', async () => {
                (fs.readFile as jest.Mock).mockResolvedValue(
                    Buffer.from('testdata')
                );
                const result = await imageUrlToDataUrl(
                    'relative/path/to/img.webp'
                );
                expect(result).toMatch(/^data:image\/webp;base64,/);
                expect(fs.readFile).toHaveBeenCalledWith(
                    path.resolve(process.cwd(), 'relative/path/to/img.webp')
                );
            });

            it('should throw if fs.readFile fails', async () => {
                (fs.readFile as jest.Mock).mockRejectedValue(
                    new Error('File not found')
                );
                await expect(imageUrlToDataUrl('missing.bmp')).rejects.toThrow(
                    /Could not read image from path: missing.bmp/
                );
            });

            it('should use default octet-stream for unknown extension', async () => {
                (fs.readFile as jest.Mock).mockResolvedValue(
                    Buffer.from('testdata')
                );
                const result = await imageUrlToDataUrl('file.unknown');
                expect(result).toMatch(
                    /^data:application\/octet-stream;base64,/
                );
            });

            it('should map bmp to image/bmp', async () => {
                (fs.readFile as jest.Mock).mockResolvedValue(
                    Buffer.from('testdata')
                );
                const result = await imageUrlToDataUrl('file.bmp');
                expect(result).toMatch(/^data:image\/bmp;base64,/);
            });

            it('should map jpg to jpeg', async () => {
                (fs.readFile as jest.Mock).mockResolvedValue(
                    Buffer.from('testdata')
                );
                const result = await imageUrlToDataUrl('file.jpg');
                expect(result).toMatch(/^data:image\/jpeg;base64,/);
            });
        });
    });
});
