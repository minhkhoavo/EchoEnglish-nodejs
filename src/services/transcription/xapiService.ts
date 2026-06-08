import AdmZip from 'adm-zip';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { Types } from 'mongoose';
import AWS_CONFIG from '~/config/awsConfig.js';
import { Resource, ResourceTypeModel } from '~/models/resource.js';
import { ResourceType } from '~/enum/resourceType.js';
import { ApiError } from '~/middleware/apiError.js';
import omit from 'lodash/omit.js';

const MIME_BY_EXT: Record<string, string> = {
    '.html': 'text/html',
    '.htm': 'text/html',
    '.xml': 'application/xml',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.txt': 'text/plain',
};

function inferContentType(name: string): string {
    const ext = path.extname(name).toLowerCase();
    return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function parseTinCan(xml: string): { launchPath?: string; title?: string } {
    if (!xml) return {};
    // <launch>some/path/index_lms.html</launch>
    const tagMatch = xml.match(/<launch[^>]*>([\s\S]*?)<\/launch>/i);
    let launchPath = tagMatch?.[1]?.trim();
    if (!launchPath) {
        // launch="path"
        const attrMatch = xml.match(/\blaunch\s*=\s*"([^"]+)"/i);
        launchPath = attrMatch?.[1]?.trim();
    }
    const nameMatch = xml.match(/<name[^>]*>([\s\S]*?)<\/name>/i);
    let title = nameMatch?.[1]?.trim();
    if (title) {
        // tincan đôi khi có <langstring> bên trong <name>
        const inner = title.match(/<langstring[^>]*>([\s\S]*?)<\/langstring>/i);
        if (inner) title = inner[1].trim();
    }
    return { launchPath, title };
}

interface CreateXapiParams {
    zipBuffer: Buffer;
    fileName: string;
    createdBy?: string;
}

class XapiService {
    private s3Client = AWS_CONFIG.s3Client;
    private bucketName = AWS_CONFIG.bucketName;

    public async createXapiResource(params: CreateXapiParams) {
        const { zipBuffer, fileName, createdBy } = params;

        let zip: AdmZip;
        try {
            zip = new AdmZip(zipBuffer);
        } catch {
            throw new ApiError({
                message: 'Invalid zip file',
                status: 400,
            });
        }

        const entries = zip.getEntries();
        if (entries.length === 0) {
            throw new ApiError({
                message: 'Zip file is empty',
                status: 400,
            });
        }

        const packageId = uuidv4();
        const packagePrefix = `xapi/${packageId}`;

        // Tìm tincan.xml để parse launch path (có thể nằm trong sub-folder)
        let tinCanEntry = entries.find(
            (e) => path.basename(e.entryName).toLowerCase() === 'tincan.xml'
        );
        let tinCanInfo: ReturnType<typeof parseTinCan> = {};
        let rootInsideZip = '';
        if (tinCanEntry) {
            const xml = tinCanEntry.getData().toString('utf8');
            tinCanInfo = parseTinCan(xml);
            // Root prefix bên trong zip (ví dụ "course-name/" nếu zip có 1 thư mục root)
            rootInsideZip = path
                .dirname(tinCanEntry.entryName)
                .replace(/\\/g, '/');
            if (rootInsideZip === '.') rootInsideZip = '';
            else if (rootInsideZip && !rootInsideZip.endsWith('/'))
                rootInsideZip += '/';
        }

        // Upload từng entry lên S3 giữ nguyên đường dẫn relative
        for (const entry of entries) {
            if (entry.isDirectory) continue;
            const relative = entry.entryName.replace(/\\/g, '/');
            const key = `${packagePrefix}/${relative}`;
            const body = entry.getData();
            const command = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                Body: body,
                ContentType: inferContentType(entry.entryName),
            });
            try {
                await this.s3Client.send(command);
            } catch (err) {
                console.error('[xapiService] S3 upload failed', key, err);
                throw new ApiError({
                    message: 'Failed to upload xAPI package to S3',
                    status: 500,
                });
            }
        }

        // Resolve launch path
        const candidates: string[] = [];
        if (tinCanInfo.launchPath) {
            const lp = tinCanInfo.launchPath.replace(/^\.?\//, '');
            candidates.push(`${rootInsideZip}${lp}`);
            candidates.push(lp);
        }
        candidates.push(
            `${rootInsideZip}index_lms.html`,
            `${rootInsideZip}index_lms_html5.html`,
            `${rootInsideZip}index.html`,
            'index_lms.html',
            'index_lms_html5.html',
            'index.html'
        );

        const entryNames = new Set(
            entries.map((e) => e.entryName.replace(/\\/g, '/'))
        );
        const launchInsideZip = candidates.find((c) => entryNames.has(c));
        if (!launchInsideZip) {
            throw new ApiError({
                message:
                    'Cannot find launch file (tincan.xml launch / index_lms.html / index.html)',
                status: 400,
            });
        }

        const launchUrl = `https://${this.bucketName}.s3.${AWS_CONFIG.region}.amazonaws.com/${packagePrefix}/${launchInsideZip}`;

        const baseTitle =
            tinCanInfo.title ||
            path.basename(fileName, path.extname(fileName)) ||
            'xAPI Course';

        const payload: Partial<ResourceTypeModel> = {
            type: ResourceType.XAPI,
            title: baseTitle,
            xapiLaunchUrl: launchUrl,
            xapiPackageKey: packagePrefix,
            publishedAt: new Date(),
            lang: 'en',
            suitableForLearners: true,
            createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
        };

        const resource = await Resource.create(payload);
        return omit(resource.toObject(), ['__v']);
    }
}

export default new XapiService();
