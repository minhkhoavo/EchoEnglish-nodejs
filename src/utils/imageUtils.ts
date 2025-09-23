import * as fs from 'fs/promises';
import * as path from 'path';

export async function imageUrlToDataUrl(imageUrl: string): Promise<string> {
    if (!imageUrl) throw new Error('Empty imageUrl');
    if (imageUrl.startsWith('data:')) return imageUrl;

    const mimeFromExt = (ext: string) => {
        switch (ext.toLowerCase()) {
            case 'jpg':
            case 'jpeg':
                return 'image/jpeg';
            case 'png':
                return 'image/png';
            case 'gif':
                return 'image/gif';
            case 'webp':
                return 'image/webp';
            case 'bmp':
                return 'image/bmp';
            default:
                return 'application/octet-stream';
        }
    };

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        let contentType = res.headers.get('content-type') || '';
        if (!contentType) {
            const ext = path
                .extname(new URL(imageUrl).pathname)
                .replace('.', '');
            contentType = mimeFromExt(ext);
        }
        return `data:${contentType};base64,${buffer.toString('base64')}`;
    }

    try {
        const resolved = path.isAbsolute(imageUrl)
            ? imageUrl
            : path.resolve(process.cwd(), imageUrl);
        const fileBuffer = await fs.readFile(resolved);
        const ext = path.extname(resolved).replace('.', '');
        const contentType = mimeFromExt(ext);
        return `data:${contentType};base64,${fileBuffer.toString('base64')}`;
    } catch (err) {
        throw new Error(`Could not read image from path: ${imageUrl}. ${err}`);
    }
}
