/* eslint-disable @typescript-eslint/no-explicit-any */
import recordingService from '~/services/recordingService.js';
import RecordingModel from '~/models/recordingModel.js';

// ──────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────
jest.mock('~/models/recordingModel.js', () => {
    const mockModel: any = {
        create: jest.fn(),
        find: jest.fn(),
        findById: jest.fn(),
        findByIdAndDelete: jest.fn(),
        findByIdAndUpdate: jest.fn(),
    };
    return {
        __esModule: true,
        default: mockModel,
    };
});

const mockedModel = RecordingModel as jest.Mocked<typeof RecordingModel>;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function buildMockRecording(overrides: Record<string, any> = {}) {
    return {
        _id: 'rec-123',
        userId: 'user-123',
        name: 'test-recording.webm',
        url: 'https://s3.amazonaws.com/test/recording.webm',
        duration: 30,
        speakingTime: 25,
        mimeType: 'audio/webm',
        size: 1024,
        transcript: 'Hello world',
        analysisStatus: 'done',
        analysis: null,
        createdAt: new Date('2026-06-15T00:00:00Z'),
        ...overrides,
    };
}

describe('RecordingService', () => {
    let mockSelect: jest.Mock;
    let mockSort: jest.Mock;
    let mockLean: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();

        // Chain setup for find().select().sort().lean()
        mockLean = jest.fn();
        mockSort = jest.fn().mockReturnValue({ lean: mockLean });
        mockSelect = jest.fn().mockReturnValue({ sort: mockSort });
        (mockedModel.find as any).mockReturnValue({ select: mockSelect });

        // Chain setup for findById().lean()
        (mockedModel.findById as any).mockReturnValue({ lean: jest.fn() });

        // Chain setup for findByIdAndDelete().lean()
        (mockedModel.findByIdAndDelete as any).mockReturnValue({
            lean: jest.fn(),
        });

        // Chain setup for findByIdAndUpdate().lean()
        (mockedModel.findByIdAndUpdate as any).mockReturnValue({
            lean: jest.fn(),
        });
    });

    // ════════════════════════════════════════════
    // create()
    // ════════════════════════════════════════════
    describe('create', () => {
        it('should call RecordingModel.create and return toObject()', async () => {
            const payload = {
                name: 'test.webm',
                url: 'https://s3/test.webm',
                duration: 30,
                speakingTime: 25,
            };
            const mockDoc = {
                ...payload,
                toObject: () => ({ ...payload, _id: 'new-id' }),
            };
            (mockedModel.create as any).mockResolvedValue(mockDoc);

            const result = await recordingService.create(payload as any);

            expect(mockedModel.create).toHaveBeenCalledWith(payload);
            expect(result).toEqual({ ...payload, _id: 'new-id' });
        });
    });

    // ════════════════════════════════════════════
    // list()
    // ════════════════════════════════════════════
    describe('list', () => {
        it('should list all recordings without userId filter', async () => {
            const mockItems = [buildMockRecording()];
            mockLean.mockResolvedValue(mockItems);

            const result = await recordingService.list({});

            expect(mockedModel.find).toHaveBeenCalledWith({});
            expect(mockSelect).toHaveBeenCalledWith('-analysis');
            expect(mockSort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(result).toEqual({ items: mockItems });
        });

        it('should filter by userId when provided', async () => {
            mockLean.mockResolvedValue([]);

            await recordingService.list({ userId: 'user-123' });

            expect(mockedModel.find).toHaveBeenCalledWith({
                userId: 'user-123',
            });
        });
    });

    // ════════════════════════════════════════════
    // getById()
    // ════════════════════════════════════════════
    describe('getById', () => {
        it('should call findById with id and chain lean()', async () => {
            const mockRec = buildMockRecording();
            const mockFindByIdLean = jest.fn().mockResolvedValue(mockRec);
            (mockedModel.findById as any).mockReturnValue({
                lean: mockFindByIdLean,
            });

            const result = await recordingService.getById('rec-123');

            expect(mockedModel.findById).toHaveBeenCalledWith('rec-123');
            expect(result).toEqual(mockRec);
        });
    });

    // ════════════════════════════════════════════
    // getRecordingSummary()
    // ════════════════════════════════════════════
    describe('getRecordingSummary', () => {
        it('should return null if recording is not found', async () => {
            const mockFindByIdLean = jest.fn().mockResolvedValue(null);
            (mockedModel.findById as any).mockReturnValue({
                lean: mockFindByIdLean,
            });

            const result =
                await recordingService.getRecordingSummary('nonexistent');
            expect(result).toBeNull();
        });

        it('should return null if recording has no analysis', async () => {
            const mockRec = buildMockRecording({ analysis: null });
            const mockFindByIdLean = jest.fn().mockResolvedValue(mockRec);
            (mockedModel.findById as any).mockReturnValue({
                lean: mockFindByIdLean,
            });

            const result =
                await recordingService.getRecordingSummary('rec-123');
            expect(result).toBeNull();
        });

        it('should return full summary with scores and empty qualitative arrays when no issues', async () => {
            const mockRec = buildMockRecording({
                transcript: 'Hello world',
                analysis: {
                    overall: {
                        PronScore: 85,
                        FluencyScore: 90,
                        ProsodyScore: 80,
                    },
                    analyses: {
                        fluency: { words_per_minute: 120 },
                    },
                    segments: [
                        {
                            words: [
                                {
                                    word: 'hello',
                                    accuracy: 95,
                                    isDuplicated: false,
                                },
                                {
                                    word: 'world',
                                    accuracy: 88,
                                    isDuplicated: false,
                                },
                            ],
                        },
                    ],
                },
            });
            const mockFindByIdLean = jest.fn().mockResolvedValue(mockRec);
            (mockedModel.findById as any).mockReturnValue({
                lean: mockFindByIdLean,
            });

            const result =
                await recordingService.getRecordingSummary('rec-123');

            expect(result).toEqual({
                transcript: 'Hello world',
                quantitativeMetrics: {
                    pronunciationScore: 85,
                    fluencyScore: 90,
                    prosodyScore: 80,
                    wordsPerMinute: 120,
                },
                qualitativeAnalysis: {
                    pronunciationMistakes: [],
                    fluencyIssues: [],
                },
            });
        });

        it('should detect low accuracy words (< 50)', async () => {
            const mockRec = buildMockRecording({
                analysis: {
                    overall: {},
                    analyses: { fluency: {} },
                    segments: [
                        {
                            words: [
                                {
                                    word: 'difficult',
                                    accuracy: 30,
                                    isDuplicated: false,
                                },
                                {
                                    word: 'hard',
                                    accuracy: 20,
                                    isDuplicated: false,
                                },
                                {
                                    word: 'easy',
                                    accuracy: 95,
                                    isDuplicated: false,
                                },
                            ],
                        },
                    ],
                },
            });
            const mockFindByIdLean = jest.fn().mockResolvedValue(mockRec);
            (mockedModel.findById as any).mockReturnValue({
                lean: mockFindByIdLean,
            });

            const result: any =
                await recordingService.getRecordingSummary('rec-123');

            expect(
                result.qualitativeAnalysis.pronunciationMistakes
            ).toContainEqual(expect.stringContaining("'difficult'"));
            expect(
                result.qualitativeAnalysis.pronunciationMistakes
            ).toContainEqual(expect.stringContaining("'hard'"));
        });

        it('should detect unpronounced word endings (-ed, -s)', async () => {
            const mockRec = buildMockRecording({
                analysis: {
                    overall: {},
                    analyses: { fluency: {} },
                    segments: [
                        {
                            words: [
                                {
                                    word: 'walked',
                                    accuracy: 80,
                                    actualPronunciation: '/wɔːk/',
                                    isDuplicated: false,
                                },
                                {
                                    word: 'cats',
                                    accuracy: 80,
                                    actualPronunciation: '/kæ/',
                                    isDuplicated: false,
                                },
                            ],
                        },
                    ],
                },
            });
            const mockFindByIdLean = jest.fn().mockResolvedValue(mockRec);
            (mockedModel.findById as any).mockReturnValue({
                lean: mockFindByIdLean,
            });

            const result: any =
                await recordingService.getRecordingSummary('rec-123');

            expect(
                result.qualitativeAnalysis.pronunciationMistakes
            ).toContainEqual(expect.stringContaining('Final sound mistake'));
        });

        it('should NOT flag words ending in -ed/-s if pronunciation ends properly', async () => {
            const mockRec = buildMockRecording({
                analysis: {
                    overall: {},
                    analyses: { fluency: {} },
                    segments: [
                        {
                            words: [
                                {
                                    word: 'walked',
                                    accuracy: 80,
                                    actualPronunciation: '/wɔːkt/',
                                    isDuplicated: false,
                                },
                                {
                                    word: 'cats',
                                    accuracy: 80,
                                    actualPronunciation: '/kæts/',
                                    isDuplicated: false,
                                },
                            ],
                        },
                    ],
                },
            });
            const mockFindByIdLean = jest.fn().mockResolvedValue(mockRec);
            (mockedModel.findById as any).mockReturnValue({
                lean: mockFindByIdLean,
            });

            const result: any =
                await recordingService.getRecordingSummary('rec-123');

            const finalSoundMistakes =
                result.qualitativeAnalysis.pronunciationMistakes.filter(
                    (m: string) => m.includes('Final sound mistake')
                );
            expect(finalSoundMistakes).toHaveLength(0);
        });

        it('should detect words with errors array', async () => {
            const mockRec = buildMockRecording({
                analysis: {
                    overall: {},
                    analyses: { fluency: {} },
                    segments: [
                        {
                            words: [
                                {
                                    word: 'think',
                                    accuracy: 60,
                                    isDuplicated: false,
                                    errors: [
                                        { type: 'substitution' },
                                        { type: 'omission' },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            });
            const mockFindByIdLean = jest.fn().mockResolvedValue(mockRec);
            (mockedModel.findById as any).mockReturnValue({
                lean: mockFindByIdLean,
            });

            const result: any =
                await recordingService.getRecordingSummary('rec-123');

            expect(
                result.qualitativeAnalysis.pronunciationMistakes
            ).toContainEqual(expect.stringContaining("'think'"));
            expect(
                result.qualitativeAnalysis.pronunciationMistakes
            ).toContainEqual(expect.stringContaining('substitution, omission'));
        });

        it('should detect duplicated words as fluency issues', async () => {
            const mockRec = buildMockRecording({
                analysis: {
                    overall: {},
                    analyses: { fluency: {} },
                    segments: [
                        {
                            words: [
                                {
                                    word: 'the',
                                    accuracy: 90,
                                    isDuplicated: true,
                                },
                                {
                                    word: 'cat',
                                    accuracy: 90,
                                    isDuplicated: false,
                                },
                            ],
                        },
                    ],
                },
            });
            const mockFindByIdLean = jest.fn().mockResolvedValue(mockRec);
            (mockedModel.findById as any).mockReturnValue({
                lean: mockFindByIdLean,
            });

            const result: any =
                await recordingService.getRecordingSummary('rec-123');

            expect(result.qualitativeAnalysis.fluencyIssues).toContainEqual(
                expect.stringContaining("'the'")
            );
            expect(result.qualitativeAnalysis.fluencyIssues).toContainEqual(
                expect.stringContaining('Repetition error')
            );
        });

        it('should handle missing segments gracefully (empty words)', async () => {
            const mockRec = buildMockRecording({
                analysis: {
                    overall: {},
                    analyses: { fluency: {} },
                    segments: [{}], // no words property
                },
            });
            const mockFindByIdLean = jest.fn().mockResolvedValue(mockRec);
            (mockedModel.findById as any).mockReturnValue({
                lean: mockFindByIdLean,
            });

            const result: any =
                await recordingService.getRecordingSummary('rec-123');

            expect(result.qualitativeAnalysis.pronunciationMistakes).toEqual(
                []
            );
            expect(result.qualitativeAnalysis.fluencyIssues).toEqual([]);
        });

        it('should default to empty transcript when transcript is undefined', async () => {
            const mockRec = buildMockRecording({
                transcript: undefined,
                analysis: {
                    overall: {},
                    analyses: { fluency: {} },
                    segments: [{ words: [] }],
                },
            });
            const mockFindByIdLean = jest.fn().mockResolvedValue(mockRec);
            (mockedModel.findById as any).mockReturnValue({
                lean: mockFindByIdLean,
            });

            const result: any =
                await recordingService.getRecordingSummary('rec-123');

            expect(result.transcript).toBe('');
        });
    });

    // ════════════════════════════════════════════
    // remove()
    // ════════════════════════════════════════════
    describe('remove', () => {
        it('should call findByIdAndDelete with id and chain lean()', async () => {
            const mockDeleted = buildMockRecording();
            const mockLeanDel = jest.fn().mockResolvedValue(mockDeleted);
            (mockedModel.findByIdAndDelete as any).mockReturnValue({
                lean: mockLeanDel,
            });

            const result = await recordingService.remove('rec-123');

            expect(mockedModel.findByIdAndDelete).toHaveBeenCalledWith(
                'rec-123'
            );
            expect(result).toEqual(mockDeleted);
        });
    });

    // ════════════════════════════════════════════
    // update()
    // ════════════════════════════════════════════
    describe('update', () => {
        it('should call findByIdAndUpdate with correct parameters', async () => {
            const patch = { name: 'updated-name.webm' };
            const updated = buildMockRecording({ name: 'updated-name.webm' });
            const mockLeanUpd = jest.fn().mockResolvedValue(updated);
            (mockedModel.findByIdAndUpdate as any).mockReturnValue({
                lean: mockLeanUpd,
            });

            const result = await recordingService.update(
                'rec-123',
                patch as any
            );

            expect(mockedModel.findByIdAndUpdate).toHaveBeenCalledWith(
                'rec-123',
                { $set: patch },
                { new: true }
            );
            expect(result).toEqual(updated);
        });
    });
});
