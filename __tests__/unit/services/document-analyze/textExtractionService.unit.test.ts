/* eslint-disable @typescript-eslint/no-explicit-any */
import { textExtractionService } from '~/services/document-analyze/textExtractionService.js';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

jest.mock('mammoth', () => ({
    extractRawText: jest.fn(),
}));
jest.mock('pdf-parse/lib/pdf-parse.js', () => jest.fn());

describe('TextExtractionService', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});
    });

    afterEach(() => {
        if (consoleLogSpy) consoleLogSpy.mockRestore();
        if (consoleWarnSpy) consoleWarnSpy.mockRestore();
        if (consoleErrorSpy) consoleErrorSpy.mockRestore();
    });

    const createMockFile = (
        mimetype: string,
        originalname: string,
        content: string = 'test'
    ): Express.Multer.File => ({
        mimetype,
        originalname,
        buffer: Buffer.from(content, 'utf8'),
        fieldname: 'file',
        encoding: '7bit',
        size: Buffer.from(content).length,
        destination: '',
        filename: '',
        path: '',
        stream: null as any,
    });

    describe('PDF Extraction', () => {
        it('should extract text from pdf by mimetype', async () => {
            (pdfParse as jest.Mock).mockResolvedValue({ text: 'pdf content' });
            const file = createMockFile('application/pdf', 'test.unknown');
            const result = await textExtractionService.extractText(file);
            expect(result.text).toBe('pdf content');
            expect(pdfParse).toHaveBeenCalledWith(file.buffer);
        });

        it('should extract text from pdf by extension', async () => {
            (pdfParse as jest.Mock).mockResolvedValue({ text: 'pdf content' });
            const file = createMockFile('unknown', 'test.pdf');
            const result = await textExtractionService.extractText(file);
            expect(result.text).toBe('pdf content');
        });

        it('should catch pdf parse error and throw', async () => {
            (pdfParse as jest.Mock).mockRejectedValue(new Error('pdf error'));
            const file = createMockFile('application/pdf', 'test.pdf');
            await expect(
                textExtractionService.extractText(file)
            ).rejects.toThrow('Cannot read PDF content');
            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        it('should handle undefined text from pdf-parse', async () => {
            (pdfParse as jest.Mock).mockResolvedValue({ text: undefined });
            const file = createMockFile('application/pdf', 'test.pdf');
            await expect(
                textExtractionService.extractText(file)
            ).rejects.toThrow('Cannot extract any text from the file');
        });
    });

    describe('DOCX Extraction', () => {
        it('should extract text from docx by mimetype', async () => {
            (mammoth.extractRawText as jest.Mock).mockResolvedValue({
                value: 'docx content',
            });
            const file = createMockFile(
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'test.unknown'
            );
            const result = await textExtractionService.extractText(file);
            expect(result.text).toBe('docx content');
            expect(mammoth.extractRawText).toHaveBeenCalledWith({
                buffer: file.buffer,
            });
        });

        it('should extract text from docx by extension', async () => {
            (mammoth.extractRawText as jest.Mock).mockResolvedValue({
                value: 'docx content',
            });
            const file = createMockFile('unknown', 'test.docx');
            const result = await textExtractionService.extractText(file);
            expect(result.text).toBe('docx content');
        });

        it('should catch docx parse error and throw', async () => {
            (mammoth.extractRawText as jest.Mock).mockRejectedValue(
                new Error('docx error')
            );
            const file = createMockFile(
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'test.docx'
            );
            await expect(
                textExtractionService.extractText(file)
            ).rejects.toThrow('Cannot read DOCX content');
            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        it('should handle undefined value from mammoth', async () => {
            (mammoth.extractRawText as jest.Mock).mockResolvedValue({
                value: undefined,
            });
            const file = createMockFile('unknown', 'test.docx');
            await expect(
                textExtractionService.extractText(file)
            ).rejects.toThrow('Cannot extract any text from the file');
        });
    });

    describe('Text Extraction', () => {
        it('should extract from text/plain mimetype', async () => {
            const file = createMockFile(
                'text/plain',
                'test.unknown',
                'txt content'
            );
            const result = await textExtractionService.extractText(file);
            expect(result.text).toBe('txt content');
        });

        it('should extract from .txt extension', async () => {
            const file = createMockFile('unknown', 'test.txt', 'txt content');
            const result = await textExtractionService.extractText(file);
            expect(result.text).toBe('txt content');
        });
    });

    describe('Other Formats', () => {
        it('should extract from application/msword mimetype', async () => {
            const file = createMockFile(
                'application/msword',
                'test.unknown',
                'doc content'
            );
            const result = await textExtractionService.extractText(file);
            expect(result.text).toBe('doc content');
        });

        it('should extract from .doc extension', async () => {
            const file = createMockFile('unknown', 'test.doc', 'doc content');
            const result = await textExtractionService.extractText(file);
            expect(result.text).toBe('doc content');
        });

        it('should fallback to buffer.toString for unknown formats', async () => {
            const file = createMockFile(
                'unknown/mime',
                'test.unknown',
                'unknown content'
            );
            const result = await textExtractionService.extractText(file);
            expect(result.text).toBe('unknown content');
        });

        it('should reject image files', async () => {
            const file = createMockFile('image/png', 'test.png');
            await expect(
                textExtractionService.extractText(file)
            ).rejects.toThrow('Image files are not supported for analysis yet');
        });

        it('should reject audio files', async () => {
            const file = createMockFile('audio/mp3', 'test.mp3');
            await expect(
                textExtractionService.extractText(file)
            ).rejects.toThrow(
                'Audio files require transcription before analysis'
            );
        });
    });

    describe('Data cleaning and limits', () => {
        it('should strip control characters and normalize whitespace', async () => {
            const rawContent = 'hello\x00\x01world   \n\t  test';
            const file = createMockFile('text/plain', 'test.txt', rawContent);
            const result = await textExtractionService.extractText(file);
            // control chars become space, then multiple spaces become single space
            expect(result.text).toBe('hello world test');
        });

        it('should throw if cleaned text is empty', async () => {
            const file = createMockFile('text/plain', 'test.txt', '   \n\t   ');
            await expect(
                textExtractionService.extractText(file)
            ).rejects.toThrow('Cannot extract any text from the file');
        });

        it('should truncate text at 200,000 characters', async () => {
            const longText = 'a'.repeat(250_000);
            const file = createMockFile('text/plain', 'test.txt', longText);
            const result = await textExtractionService.extractText(file);
            expect(result.text.length).toBe(200_000);
            expect(result.text).toBe('a'.repeat(200_000));
        });
    });
});
