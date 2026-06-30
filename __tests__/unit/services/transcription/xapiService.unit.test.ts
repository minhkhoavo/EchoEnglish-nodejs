/* eslint-disable @typescript-eslint/no-explicit-any */
import xapiService from '~/services/transcription/xapiService.js';
import { Resource } from '~/models/resource.js';

import AWS_CONFIG from '~/config/awsConfig.js';
import AdmZip from 'adm-zip';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

// ──────────────────────────────────────────────
// Module-Level Mocks
// ──────────────────────────────────────────────
jest.mock('~/models/resource.js', () => {
    const mockModel: any = {
        create: jest.fn(),
    };
    return {
        __esModule: true,
        Resource: mockModel,
        default: mockModel,
    };
});

jest.mock('~/config/awsConfig.js', () => ({
    __esModule: true,
    default: {
        s3Client: {
            send: jest.fn(),
        },
        bucketName: 'test-bucket',
        region: 'us-east-1',
    },
}));

jest.mock('adm-zip');

jest.mock('uuid', () => ({
    v4: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
    PutObjectCommand: jest.fn().mockImplementation((opts) => opts),
}));

const mockedResource = Resource as jest.Mocked<typeof Resource>;
const mockedAWSConfig = AWS_CONFIG as jest.Mocked<any>;
const mockedAdmZip = AdmZip as jest.Mock;
const mockedUuid = uuidv4 as unknown as jest.Mock;

describe('XapiService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedUuid.mockReturnValue('mocked-uuid-1234');
    });

    it('should throw ApiError status 400 when zip file is invalid (AdmZip throws error)', async () => {
        mockedAdmZip.mockImplementationOnce(() => {
            throw new Error('Corrupt zip file');
        });

        await expect(
            xapiService.createXapiResource({
                zipBuffer: Buffer.from('corrupt'),
                fileName: 'test.zip',
            })
        ).rejects.toMatchObject({
            status: 400,
            message: 'Invalid zip file',
        });
    });

    it('should throw ApiError status 400 when zip file has no entries', async () => {
        mockedAdmZip.mockImplementationOnce(() => ({
            getEntries: () => [],
        }));

        await expect(
            xapiService.createXapiResource({
                zipBuffer: Buffer.from('empty'),
                fileName: 'test.zip',
            })
        ).rejects.toMatchObject({
            status: 400,
            message: 'Zip file is empty',
        });
    });

    it('should throw ApiError status 400 when no launch file can be found in zip entries', async () => {
        const mockEntries = [
            {
                entryName: 'style.css',
                isDirectory: false,
                getData: () => Buffer.from('css'),
            },
            {
                entryName: 'image.png',
                isDirectory: false,
                getData: () => Buffer.from('png'),
            },
        ];
        mockedAdmZip.mockImplementationOnce(() => ({
            getEntries: () => mockEntries,
        }));

        await expect(
            xapiService.createXapiResource({
                zipBuffer: Buffer.from('no-launch'),
                fileName: 'test.zip',
            })
        ).rejects.toMatchObject({
            status: 400,
            message: expect.stringContaining('Cannot find launch file'),
        });
    });

    it('should upload all non-directory entries to S3 and create resource using fallback launch files and filename title', async () => {
        const mockEntries = [
            {
                entryName: 'course/',
                isDirectory: true,
                getData: () => Buffer.from(''),
            },
            {
                entryName: 'index.html',
                isDirectory: false,
                getData: () => Buffer.from('html content'),
            },
            {
                entryName: 'style.css',
                isDirectory: false,
                getData: () => Buffer.from('css content'),
            },
            {
                entryName: 'file.xyz',
                isDirectory: false,
                getData: () => Buffer.from('xyz content'),
            },
        ];

        mockedAdmZip.mockImplementationOnce(() => ({
            getEntries: () => mockEntries,
        }));

        const mockCreatedResource = {
            _id: 'res-xapi-123',
            type: 'xapi',
            title: 'my-course',
            xapiLaunchUrl:
                'https://test-bucket.s3.us-east-1.amazonaws.com/xapi/mocked-uuid-1234/index.html',
            xapiPackageKey: 'xapi/mocked-uuid-1234',
            toObject: () => ({
                _id: 'res-xapi-123',
                type: 'xapi',
                title: 'my-course',
            }),
        };
        mockedResource.create.mockResolvedValue(mockCreatedResource as any);
        mockedAWSConfig.s3Client.send.mockResolvedValue({});

        const result = await xapiService.createXapiResource({
            zipBuffer: Buffer.from('course-zip'),
            fileName: 'my-course.zip',
            createdBy: '60f8e8b4e7c8e8b4e7c8e8b4',
        });

        // Verify S3 uploads (should skip course/ directory, upload 3 files)
        expect(mockedAWSConfig.s3Client.send).toHaveBeenCalledTimes(3);
        expect(PutObjectCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                Bucket: 'test-bucket',
                Key: 'xapi/mocked-uuid-1234/index.html',
                Body: Buffer.from('html content'),
                ContentType: 'text/html',
            })
        );
        expect(PutObjectCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                Bucket: 'test-bucket',
                Key: 'xapi/mocked-uuid-1234/style.css',
                Body: Buffer.from('css content'),
                ContentType: 'text/css',
            })
        );
        expect(PutObjectCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                Bucket: 'test-bucket',
                Key: 'xapi/mocked-uuid-1234/file.xyz',
                Body: Buffer.from('xyz content'),
                ContentType: 'application/octet-stream',
            })
        );

        // Verify DB Resource creation
        expect(mockedResource.create).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'xapi',
                title: 'my-course',
                xapiLaunchUrl:
                    'https://test-bucket.s3.us-east-1.amazonaws.com/xapi/mocked-uuid-1234/index.html',
                xapiPackageKey: 'xapi/mocked-uuid-1234',
                suitableForLearners: true,
                createdBy: expect.any(Object), // Types.ObjectId(createdBy)
            })
        );

        expect(result.title).toBe('my-course');
    });

    it('should throw ApiError status 500 when S3 client upload fails', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        const mockEntries = [
            {
                entryName: 'index.html',
                isDirectory: false,
                getData: () => Buffer.from('html'),
            },
        ];
        mockedAdmZip.mockImplementationOnce(() => ({
            getEntries: () => mockEntries,
        }));

        mockedAWSConfig.s3Client.send.mockRejectedValue(new Error('S3 error'));

        await expect(
            xapiService.createXapiResource({
                zipBuffer: Buffer.from('s3-fail'),
                fileName: 'fail.zip',
            })
        ).rejects.toMatchObject({
            status: 500,
            message: 'Failed to upload xAPI package to S3',
        });

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should parse tincan.xml for launchPath and title and resolve correct S3 URL', async () => {
        const tincanXml = `
            <?xml version="1.0" encoding="utf-8" ?>
            <tincan xmlns="http://projecttincan.com/tincan.xml">
                <activities>
                    <activity id="http://example.com" type="course">
                        <name lang="en-US">Parsed TinCan Title</name>
                        <description lang="en-US">Course description</description>
                        <launch>custom_path/index_lms.html</launch>
                    </activity>
                </activities>
            </tincan>
        `;

        const mockEntries = [
            {
                entryName: 'tincan.xml',
                isDirectory: false,
                getData: () => Buffer.from(tincanXml, 'utf8'),
            },
            {
                entryName: 'custom_path/index_lms.html',
                isDirectory: false,
                getData: () => Buffer.from('lms html'),
            },
        ];

        mockedAdmZip.mockImplementationOnce(() => ({
            getEntries: () => mockEntries,
        }));

        const mockCreatedResource = {
            _id: 'res-xapi-tincan',
            toObject: () => ({
                _id: 'res-xapi-tincan',
                title: 'Parsed TinCan Title',
            }),
        };
        mockedResource.create.mockResolvedValue(mockCreatedResource as any);
        mockedAWSConfig.s3Client.send.mockResolvedValue({});

        const result = await xapiService.createXapiResource({
            zipBuffer: Buffer.from('tincan-zip'),
            fileName: 'tincan.zip',
        });

        expect(mockedResource.create).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Parsed TinCan Title',
                xapiLaunchUrl:
                    'https://test-bucket.s3.us-east-1.amazonaws.com/xapi/mocked-uuid-1234/custom_path/index_lms.html',
            })
        );
        expect(result.title).toBe('Parsed TinCan Title');
    });

    it('should fallback to tagMatch name if langstring or specific tags are structured differently in tincan.xml', async () => {
        const tincanXmlSimple = `
            <tincan>
                <launch>launch_simple.html</launch>
                <name>Simple Title Match</name>
            </tincan>
        `;

        const mockEntries = [
            {
                entryName: 'tincan.xml',
                isDirectory: false,
                getData: () => Buffer.from(tincanXmlSimple, 'utf8'),
            },
            {
                entryName: 'launch_simple.html',
                isDirectory: false,
                getData: () => Buffer.from('simple'),
            },
        ];

        mockedAdmZip.mockImplementationOnce(() => ({
            getEntries: () => mockEntries,
        }));

        mockedResource.create.mockResolvedValue({
            toObject: () => ({ title: 'Simple Title Match' }),
        } as any);

        const result = await xapiService.createXapiResource({
            zipBuffer: Buffer.from('simple-zip'),
            fileName: 'simple.zip',
        });

        expect(mockedResource.create).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Simple Title Match',
                xapiLaunchUrl:
                    'https://test-bucket.s3.us-east-1.amazonaws.com/xapi/mocked-uuid-1234/launch_simple.html',
            })
        );
        expect(result.title).toBe('Simple Title Match');
    });

    it('should support launch attribute format inside tincan.xml if no launch tag exists', async () => {
        const tincanXmlAttr = `
            <tincan launch="attr_launch.html">
                <name><langstring>Attr Title</langstring></name>
            </tincan>
        `;

        const mockEntries = [
            {
                entryName: 'nested/tincan.xml',
                isDirectory: false,
                getData: () => Buffer.from(tincanXmlAttr, 'utf8'),
            },
            {
                entryName: 'nested/attr_launch.html',
                isDirectory: false,
                getData: () => Buffer.from('attr launch html'),
            },
        ];

        mockedAdmZip.mockImplementationOnce(() => ({
            getEntries: () => mockEntries,
        }));

        mockedResource.create.mockResolvedValue({
            toObject: () => ({ title: 'Attr Title' }),
        } as any);

        await xapiService.createXapiResource({
            zipBuffer: Buffer.from('attr-zip'),
            fileName: 'attr.zip',
        });

        expect(mockedResource.create).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Attr Title',
                // rootInsideZip is 'nested/' since tincan.xml is under 'nested/'
                xapiLaunchUrl:
                    'https://test-bucket.s3.us-east-1.amazonaws.com/xapi/mocked-uuid-1234/nested/attr_launch.html',
            })
        );
    });

    it('should return empty objects when parsing an empty or invalid tincan.xml and fallback to default title', async () => {
        const mockEntries = [
            {
                entryName: 'tincan.xml',
                isDirectory: false,
                getData: () => Buffer.from('', 'utf8'), // Empty XML content
            },
            {
                entryName: 'index.html',
                isDirectory: false,
                getData: () => Buffer.from('index'),
            },
        ];

        mockedAdmZip.mockImplementationOnce(() => ({
            getEntries: () => mockEntries,
        }));

        mockedResource.create.mockResolvedValue({
            toObject: () => ({ title: 'xAPI Course' }),
        } as any);

        await xapiService.createXapiResource({
            zipBuffer: Buffer.from('empty-tincan-zip'),
            fileName: '',
        });

        expect(mockedResource.create).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'xAPI Course',
                xapiLaunchUrl:
                    'https://test-bucket.s3.us-east-1.amazonaws.com/xapi/mocked-uuid-1234/index.html',
            })
        );
    });

    it('should fallback to filename title if tincan.xml has launch path but name tag is empty/missing', async () => {
        const tincanXmlNoName = `
            <tincan>
                <launch>launch_no_name.html</launch>
            </tincan>
        `;

        const mockEntries = [
            {
                entryName: 'tincan.xml',
                isDirectory: false,
                getData: () => Buffer.from(tincanXmlNoName, 'utf8'),
            },
            {
                entryName: 'launch_no_name.html',
                isDirectory: false,
                getData: () => Buffer.from('content'),
            },
        ];

        mockedAdmZip.mockImplementationOnce(() => ({
            getEntries: () => mockEntries,
        }));

        mockedResource.create.mockResolvedValue({
            toObject: () => ({ title: 'Fallback Title' }),
        } as any);

        await xapiService.createXapiResource({
            zipBuffer: Buffer.from('no-name-zip'),
            fileName: 'Fallback Title.zip',
        });

        expect(mockedResource.create).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Fallback Title',
                xapiLaunchUrl:
                    'https://test-bucket.s3.us-east-1.amazonaws.com/xapi/mocked-uuid-1234/launch_no_name.html',
            })
        );
    });

    it('should cover the branch where rootInsideZip ends with a slash', async () => {
        const tincanXmlSimple = `
            <tincan>
                <launch>launch_simple.html</launch>
                <name>Slash Root Title</name>
            </tincan>
        `;

        const mockEntries = [
            {
                entryName: '/tincan.xml',
                isDirectory: false,
                getData: () => Buffer.from(tincanXmlSimple, 'utf8'),
            },
            {
                entryName: 'launch_simple.html',
                isDirectory: false,
                getData: () => Buffer.from('simple'),
            },
        ];

        mockedAdmZip.mockImplementationOnce(() => ({
            getEntries: () => mockEntries,
        }));

        mockedResource.create.mockResolvedValue({
            toObject: () => ({ title: 'Slash Root Title' }),
        } as any);

        await xapiService.createXapiResource({
            zipBuffer: Buffer.from('slash-root-zip'),
            fileName: 'slash-root.zip',
        });

        expect(mockedResource.create).toHaveBeenCalled();
    });
});
