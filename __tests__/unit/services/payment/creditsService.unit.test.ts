/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import creditsService from '~/services/payment/creditsService.js';
import { User } from '~/models/userModel.js';
import { Payment } from '~/models/payment.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import notificationService from '~/services/notifications/notificationService.js';
import {
    FEATURE_PRICING_MAP,
    FEATURE_DESCRIPTION_MAP,
    FeaturePricingType,
    SPEECH_ASSESSMENT_CREDITS_PER_MINUTE,
} from '~/enum/featurePricing.js';

jest.mock('~/models/userModel.js');
jest.mock('~/models/payment.js');

const mockedUser = User as jest.Mocked<typeof User>;
const mockedPayment = Payment as jest.Mocked<typeof Payment>;

function buildMockUser(overrides: Record<string, any> = {}) {
    return {
        _id: { toString: () => 'mock-user-id' },
        credits: 100,
        ...overrides,
    };
}

function mockMongooseQuery(returnValue: any) {
    const execMock = jest.fn().mockResolvedValue(returnValue);
    const leanMock = jest.fn().mockReturnValue({ exec: execMock });
    const selectMock = jest.fn().mockReturnValue({ lean: leanMock });
    return jest.fn().mockReturnValue({
        select: selectMock,
        lean: leanMock,
        exec: execMock,
    });
}

describe('CreditsService', () => {
    let pushNotificationSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        pushNotificationSpy = jest
            .spyOn(notificationService, 'pushNotification')
            .mockResolvedValue(undefined as any);
        consoleWarnSpy = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => {});

        (mockedUser.findById as any) = mockMongooseQuery(buildMockUser());
        (mockedUser.findByIdAndUpdate as any) = mockMongooseQuery(
            buildMockUser({ credits: 90 })
        );
        (mockedPayment.create as any) = jest.fn().mockResolvedValue({
            _id: { toString: () => 'mock-transaction-id' },
        });
    });

    afterEach(() => {
        pushNotificationSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    describe('getFeaturePrice', () => {
        it('should return correct price for known feature', () => {
            const featureType = Object.keys(FEATURE_PRICING_MAP)[0]; // e.g. 'PRONUNCIATION_ASSESSMENT'
            const expectedPrice =
                FEATURE_PRICING_MAP[
                    featureType as keyof typeof FEATURE_PRICING_MAP
                ];
            expect(creditsService.getFeaturePrice(featureType)).toBe(
                expectedPrice
            );
        });

        it('should return 0 and log warn for unknown feature', () => {
            const price = creditsService.getFeaturePrice('UNKNOWN_FEATURE');
            expect(price).toBe(0);
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                'Feature pricing not found for: UNKNOWN_FEATURE'
            );
        });
    });

    describe('getFeaturePricing', () => {
        it('should return a map of all feature prices', () => {
            const pricingMap = creditsService.getFeaturePricing();
            expect(pricingMap).toEqual(FEATURE_PRICING_MAP);
        });
    });

    describe('deductCreditsForFeature', () => {
        it('should throw UNAUTHORIZED if userId is empty', async () => {
            await expect(
                creditsService.deductCreditsForFeature('', 'SOME_FEATURE')
            ).rejects.toMatchObject({
                status: ErrorMessage.UNAUTHORIZED.status,
                message: ErrorMessage.UNAUTHORIZED.message,
            });
        });

        it('should handle zero-cost features successfully when user is found', async () => {
            // Force getFeaturePrice to return 0 for a feature
            jest.spyOn(creditsService, 'getFeaturePrice').mockReturnValueOnce(
                0
            );
            const res = await creditsService.deductCreditsForFeature(
                'user-id',
                'FREE_FEATURE'
            );
            expect(res).toEqual({
                success: true,
                creditsDeducted: 0,
                remainingCredits: 100,
                transactionId: '',
            });
            expect(mockedUser.findById).toHaveBeenCalled();
            expect(mockedPayment.create).not.toHaveBeenCalled();
        });

        it('should throw USER_NOT_FOUND for zero-cost features if user not found', async () => {
            jest.spyOn(creditsService, 'getFeaturePrice').mockReturnValueOnce(
                0
            );
            (mockedUser.findById as any) = mockMongooseQuery(null);

            await expect(
                creditsService.deductCreditsForFeature(
                    'user-id',
                    'FREE_FEATURE'
                )
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        it('should fallback to 0 remainingCredits if user.credits is undefined for zero cost feature', async () => {
            jest.spyOn(creditsService, 'getFeaturePrice').mockReturnValueOnce(
                0
            );
            (mockedUser.findById as any) = mockMongooseQuery(
                buildMockUser({ credits: undefined })
            );

            const res = await creditsService.deductCreditsForFeature(
                'user-id',
                'FREE_FEATURE'
            );
            expect(res.remainingCredits).toBe(0);
        });

        it('should delegate to deductCredits when cost > 0 using description from map', async () => {
            jest.spyOn(creditsService, 'getFeaturePrice').mockReturnValueOnce(
                10
            );
            // mock the final deductCredits method to prevent actual execution logic in this test
            const deductSpy = jest
                .spyOn(creditsService, 'deductCredits')
                .mockResolvedValueOnce({
                    success: true,
                    creditsDeducted: 10,
                    remainingCredits: 90,
                    transactionId: 'txn-id',
                });

            // Need an existing feature to have a valid description map, or we can use any
            const featureType = Object.keys(FEATURE_DESCRIPTION_MAP)[0];
            await creditsService.deductCreditsForFeature(
                'user-id',
                featureType
            );

            expect(deductSpy).toHaveBeenCalledWith(
                'user-id',
                10,
                FEATURE_DESCRIPTION_MAP[
                    featureType as keyof typeof FEATURE_DESCRIPTION_MAP
                ],
                featureType
            );
            deductSpy.mockRestore();
        });

        it('should delegate to deductCredits with fallback description if not in map', async () => {
            jest.spyOn(creditsService, 'getFeaturePrice').mockReturnValueOnce(
                10
            );
            const deductSpy = jest
                .spyOn(creditsService, 'deductCredits')
                .mockResolvedValueOnce({} as any);

            await creditsService.deductCreditsForFeature(
                'user-id',
                'UNKNOWN_FEATURE'
            );
            expect(deductSpy).toHaveBeenCalledWith(
                'user-id',
                10,
                'Feature: UNKNOWN_FEATURE',
                'UNKNOWN_FEATURE'
            );
            deductSpy.mockRestore();
        });

        it('should delegate to deductCredits using provided custom description', async () => {
            jest.spyOn(creditsService, 'getFeaturePrice').mockReturnValueOnce(
                10
            );
            const deductSpy = jest
                .spyOn(creditsService, 'deductCredits')
                .mockResolvedValueOnce({} as any);

            await creditsService.deductCreditsForFeature(
                'user-id',
                'SOME_FEATURE',
                'Custom Desc'
            );
            expect(deductSpy).toHaveBeenCalledWith(
                'user-id',
                10,
                'Custom Desc',
                'SOME_FEATURE'
            );
            deductSpy.mockRestore();
        });
    });

    describe('deductCredits', () => {
        it('should throw UNAUTHORIZED if userId is empty', async () => {
            await expect(
                creditsService.deductCredits('', 10, 'desc', 'feat')
            ).rejects.toMatchObject({
                status: ErrorMessage.UNAUTHORIZED.status,
                message: ErrorMessage.UNAUTHORIZED.message,
            });
        });

        it.each([[0], [-5], [null as any], [undefined as any]])(
            'should throw INVALID_TOKEN_AMOUNT if credits is %s',
            async (credits) => {
                await expect(
                    creditsService.deductCredits(
                        'user-id',
                        credits,
                        'desc',
                        'feat'
                    )
                ).rejects.toMatchObject({
                    status: ErrorMessage.INVALID_TOKEN_AMOUNT.status,
                    message: ErrorMessage.INVALID_TOKEN_AMOUNT.message,
                });
            }
        );

        it('should throw USER_NOT_FOUND if user does not exist', async () => {
            (mockedUser.findById as any) = mockMongooseQuery(null);
            await expect(
                creditsService.deductCredits('user-id', 10, 'desc', 'feat')
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        it('should throw NOT_ENOUGH_TOKENS if user credits < required', async () => {
            (mockedUser.findById as any) = mockMongooseQuery(
                buildMockUser({ credits: 5 })
            );
            await expect(
                creditsService.deductCredits('user-id', 10, 'desc', 'feat')
            ).rejects.toMatchObject({
                status: ErrorMessage.NOT_ENOUGH_TOKENS.status,
                message: ErrorMessage.NOT_ENOUGH_TOKENS.message,
            });
        });

        it('should successfully deduct credits and return correct shape', async () => {
            const res = await creditsService.deductCredits(
                'user-id',
                10,
                'Custom Desc',
                'SOME_FEATURE'
            );

            expect(mockedUser.findByIdAndUpdate).toHaveBeenCalled();
            expect(mockedPayment.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    tokens: 10,
                    description: 'Custom Desc (SOME_FEATURE)',
                })
            );
            expect(pushNotificationSpy).toHaveBeenCalled();
            expect(res).toEqual({
                success: true,
                creditsDeducted: 10,
                remainingCredits: 90,
                transactionId: 'mock-transaction-id',
            });
        });

        it('should fallback to 0 remainingCredits if updated user has undefined credits', async () => {
            (mockedUser.findByIdAndUpdate as any) = mockMongooseQuery(
                buildMockUser({ credits: undefined })
            );
            const res = await creditsService.deductCredits(
                'user-id',
                10,
                'Custom Desc',
                'SOME_FEATURE'
            );
            expect(res.remainingCredits).toBe(0);
        });

        it('should fallback to 0 remainingCredits in notification if userUpdated is null', async () => {
            (mockedUser.findByIdAndUpdate as any) = mockMongooseQuery(null);
            await creditsService.deductCredits(
                'user-id',
                10,
                'Custom Desc',
                'SOME_FEATURE'
            );
            expect(pushNotificationSpy).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    body: expect.stringContaining('Remaining credits: 0'),
                })
            );
        });
    });

    describe('hasEnoughCredits', () => {
        it('should throw UNAUTHORIZED if no userId', async () => {
            await expect(
                creditsService.hasEnoughCredits('', 10)
            ).rejects.toMatchObject({
                status: ErrorMessage.UNAUTHORIZED.status,
                message: ErrorMessage.UNAUTHORIZED.message,
            });
        });

        it('should throw USER_NOT_FOUND if user does not exist', async () => {
            (mockedUser.findById as any) = mockMongooseQuery(null);
            await expect(
                creditsService.hasEnoughCredits('user-id', 10)
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        it('should return true if credits are sufficient', async () => {
            const res = await creditsService.hasEnoughCredits('user-id', 50);
            expect(res).toBe(true);
        });

        it('should return false if credits are insufficient', async () => {
            const res = await creditsService.hasEnoughCredits('user-id', 150);
            expect(res).toBe(false);
        });
    });

    describe('getCurrentCredits', () => {
        it('should throw UNAUTHORIZED if no userId', async () => {
            await expect(
                creditsService.getCurrentCredits('')
            ).rejects.toMatchObject({
                status: ErrorMessage.UNAUTHORIZED.status,
                message: ErrorMessage.UNAUTHORIZED.message,
            });
        });

        it('should throw USER_NOT_FOUND if user does not exist', async () => {
            (mockedUser.findById as any) = mockMongooseQuery(null);
            await expect(
                creditsService.getCurrentCredits('user-id')
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        it('should return credits value', async () => {
            const res = await creditsService.getCurrentCredits('user-id');
            expect(res).toBe(100);
        });

        it('should return 0 if credits is undefined', async () => {
            (mockedUser.findById as any) = mockMongooseQuery(
                buildMockUser({ credits: undefined })
            );
            const res = await creditsService.getCurrentCredits('user-id');
            expect(res).toBe(0);
        });
    });

    describe('checkCanAffordFeature', () => {
        it('should throw UNAUTHORIZED if no userId', async () => {
            await expect(
                creditsService.checkCanAffordFeature('', 'FEAT')
            ).rejects.toMatchObject({
                status: ErrorMessage.UNAUTHORIZED.status,
                message: ErrorMessage.UNAUTHORIZED.message,
            });
        });

        it('should throw USER_NOT_FOUND if user does not exist', async () => {
            (mockedUser.findById as any) = mockMongooseQuery(null);
            await expect(
                creditsService.checkCanAffordFeature('user-id', 'FEAT')
            ).rejects.toMatchObject({
                status: ErrorMessage.USER_NOT_FOUND.status,
                message: ErrorMessage.USER_NOT_FOUND.message,
            });
        });

        it('should return proper affordability object when user can afford', async () => {
            jest.spyOn(creditsService, 'getFeaturePrice').mockReturnValueOnce(
                50
            );
            const res = await creditsService.checkCanAffordFeature(
                'user-id',
                'FEAT'
            );
            expect(res).toEqual({
                canAfford: true,
                requiredCredits: 50,
                currentCredits: 100,
                featureType: 'FEAT',
            });
        });

        it('should return proper affordability object when user cannot afford', async () => {
            jest.spyOn(creditsService, 'getFeaturePrice').mockReturnValueOnce(
                150
            );
            const res = await creditsService.checkCanAffordFeature(
                'user-id',
                'FEAT'
            );
            expect(res).toEqual({
                canAfford: false,
                requiredCredits: 150,
                currentCredits: 100,
                featureType: 'FEAT',
            });
        });

        it('should fallback to 0 currentCredits if user credits is undefined', async () => {
            (mockedUser.findById as any) = mockMongooseQuery(
                buildMockUser({ credits: undefined })
            );
            jest.spyOn(creditsService, 'getFeaturePrice').mockReturnValueOnce(
                50
            );
            const res = await creditsService.checkCanAffordFeature(
                'user-id',
                'FEAT'
            );
            expect(res).toEqual({
                canAfford: false,
                requiredCredits: 50,
                currentCredits: 0,
                featureType: 'FEAT',
            });
        });
    });

    describe('computeSpeechAssessmentCredits', () => {
        it('should return minimum 1 credit for 0 duration or falsy values', () => {
            expect(creditsService.computeSpeechAssessmentCredits(0)).toBe(
                SPEECH_ASSESSMENT_CREDITS_PER_MINUTE
            );
            expect(
                creditsService.computeSpeechAssessmentCredits(null as any)
            ).toBe(SPEECH_ASSESSMENT_CREDITS_PER_MINUTE);
        });

        it('should round up duration to next whole minute', () => {
            // 30s -> 1 min -> 1 credit
            expect(creditsService.computeSpeechAssessmentCredits(30)).toBe(
                SPEECH_ASSESSMENT_CREDITS_PER_MINUTE
            );
            // 60s -> 1 min -> 1 credit
            expect(creditsService.computeSpeechAssessmentCredits(60)).toBe(
                SPEECH_ASSESSMENT_CREDITS_PER_MINUTE
            );
            // 61s -> 2 min -> 2 credits
            expect(creditsService.computeSpeechAssessmentCredits(61)).toBe(
                2 * SPEECH_ASSESSMENT_CREDITS_PER_MINUTE
            );
            // 120s -> 2 min -> 2 credits
            expect(creditsService.computeSpeechAssessmentCredits(120)).toBe(
                2 * SPEECH_ASSESSMENT_CREDITS_PER_MINUTE
            );
        });
    });

    describe('deductCreditsForSpeechAssessment', () => {
        it('should throw UNAUTHORIZED if userId is empty', async () => {
            await expect(
                creditsService.deductCreditsForSpeechAssessment('', 30)
            ).rejects.toMatchObject({
                status: ErrorMessage.UNAUTHORIZED.status,
                message: ErrorMessage.UNAUTHORIZED.message,
            });
        });

        it('should successfully deduct credits for speech assessment and format description', async () => {
            const deductSpy = jest
                .spyOn(creditsService, 'deductCredits')
                .mockResolvedValueOnce({
                    success: true,
                    creditsDeducted: 3 * SPEECH_ASSESSMENT_CREDITS_PER_MINUTE,
                    remainingCredits: 97,
                    transactionId: 'txn-id',
                });

            const res = await creditsService.deductCreditsForSpeechAssessment(
                'user-id',
                125 // 3 mins
            );

            expect(res).toEqual({
                success: true,
                creditsDeducted: 3 * SPEECH_ASSESSMENT_CREDITS_PER_MINUTE,
                remainingCredits: 97,
                transactionId: 'txn-id',
            });

            expect(deductSpy).toHaveBeenCalledWith(
                'user-id',
                3 * SPEECH_ASSESSMENT_CREDITS_PER_MINUTE,
                expect.stringContaining('(3 min)'),
                FeaturePricingType.SPEECH_ASSESSMENT
            );

            deductSpy.mockRestore();
        });

        it('should handle undefined duration seconds by falling back to 0', async () => {
            const deductSpy = jest
                .spyOn(creditsService, 'deductCredits')
                .mockResolvedValueOnce({
                    success: true,
                    creditsDeducted: SPEECH_ASSESSMENT_CREDITS_PER_MINUTE,
                    remainingCredits: 99,
                    transactionId: 'txn-id',
                });

            const res = await creditsService.deductCreditsForSpeechAssessment(
                'user-id',
                undefined as any
            );

            expect(res).toEqual({
                success: true,
                creditsDeducted: SPEECH_ASSESSMENT_CREDITS_PER_MINUTE,
                remainingCredits: 99,
                transactionId: 'txn-id',
            });

            expect(deductSpy).toHaveBeenCalledWith(
                'user-id',
                SPEECH_ASSESSMENT_CREDITS_PER_MINUTE,
                expect.stringContaining('(1 min)'),
                FeaturePricingType.SPEECH_ASSESSMENT
            );

            deductSpy.mockRestore();
        });
    });
});
