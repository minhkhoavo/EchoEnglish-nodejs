declare module 'pdf-parse/lib/pdf-parse.js' {
    interface PDFInfo {
        PDFFormatVersion?: string;
        IsAcroFormPresent?: boolean;
        IsXFAPresent?: boolean;
        [key: string]: unknown;
    }

    interface PDFParseResult {
        numpages: number;
        numrender: number;
        info: PDFInfo;
        metadata?: unknown;
        version?: string;
        text: string;
    }

    function pdfParse(buffer: Buffer): Promise<PDFParseResult>;
    export default pdfParse;
}
