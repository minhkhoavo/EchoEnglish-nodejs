import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import path from 'path';

class TextExtractionService {
    private readonly maxCharacters = 200_000;

    async extractText(file: Express.Multer.File): Promise<{ text: string }> {
        const ext = path.extname(file.originalname).toLowerCase();
        const mime = file.mimetype;
        let text = '';

        if (mime === 'application/pdf' || ext === '.pdf') {
            text = await this.extractFromPdf(file.buffer);
        } else if (
            mime ===
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            ext === '.docx'
        ) {
            text = await this.extractFromDocx(file.buffer);
        } else if (mime === 'text/plain' || ext === '.txt') {
            text = file.buffer.toString('utf8');
        } else if (mime.startsWith('image/')) {
            throw new Error('Image files are not supported for analysis yet');
        } else if (mime.startsWith('audio/')) {
            throw new Error(
                'Audio files require transcription before analysis'
            );
        } else if (mime === 'application/msword' || ext === '.doc') {
            text = file.buffer.toString('utf8');
        } else {
            text = file.buffer.toString('utf8');
        }

        const cleaned = this.stripControlCharacters(text);
        const normalized = cleaned.replace(/\s+/g, ' ').trim();
        if (!normalized) {
            throw new Error('Cannot extract any text from the file');
        }

        const truncated = normalized.slice(0, this.maxCharacters);

        return { text: truncated };
    }

    private stripControlCharacters(text: string): string {
        let result = '';
        for (let i = 0; i < text.length; i += 1) {
            const char = text[i];
            const code = char.charCodeAt(0);
            result += code <= 31 ? ' ' : char;
        }
        return result;
    }

    private async extractFromPdf(buffer: Buffer): Promise<string> {
        try {
            const result = await pdfParse(buffer);
            return result.text || '';
        } catch (error) {
            console.error('[TextExtractionService] PDF parse failed', error);
            throw new Error('Cannot read PDF content');
        }
    }

    private async extractFromDocx(buffer: Buffer): Promise<string> {
        try {
            const result = await mammoth.extractRawText({ buffer });
            return result.value || '';
        } catch (error) {
            console.error('[TextExtractionService] DOCX parse failed', error);
            throw new Error('Cannot read DOCX content');
        }
    }
}

export const textExtractionService = new TextExtractionService();
