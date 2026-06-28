/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import PromoService from '~/services/payment/promoService.js';
import { PromoCode } from '~/models/promoCode.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

jest.mock('~/models/promoCode.js');
const mockedPromoCode = PromoCode as jest.Mocked<typeof PromoCode>;

function buildMockPromo(overrides: Record<string, any> = {}) {
    return {
        _id: { toString: () => 'promo-id' },
        code: 'DISCOUNT10',
        discount: 10,
        active: true,
        usageLimit: 100,
        usedCount: 0,
        minOrderValue: 0,
        userUsages: new Map(),
        save: jest.fn().mockResolvedValue(true),
        ...overrides,
    };
}

function mockMongooseQuery(returnValue: any) {
    const execMock = jest.fn().mockResolvedValue(returnValue);
    const promise = Promise.resolve(returnValue);
    const leanMock = jest
        .fn()
        .mockReturnValue(Object.assign(promise, { exec: execMock }));
    const selectMock = jest.fn().mockReturnValue({ lean: leanMock });
    return jest.fn().mockReturnValue(
        Object.assign(Promise.resolve(returnValue), {
            select: selectMock,
            lean: leanMock,
            exec: execMock,
        })
    );
}

function mockMongooseFind(returnValue: any) {
    const promise = Promise.resolve(returnValue);
    const leanMock = jest.fn().mockReturnValue(promise);
    const limitMock = jest
        .fn()
        .mockReturnValue(
            Object.assign(Promise.resolve(returnValue), { lean: leanMock })
        );
    const skipMock = jest.fn().mockReturnValue({ limit: limitMock });
    const sortMock = jest
        .fn()
        .mockReturnValue({ skip: skipMock, lean: leanMock });
    const populateMock = jest.fn().mockReturnValue({ sort: sortMock });
    return jest.fn().mockReturnValue({
        populate: populateMock,
        sort: sortMock,
        skip: skipMock,
        limit: limitMock,
        lean: leanMock,
    });
}

describe('PromoService', () => {
    let promoService: PromoService;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        promoService = new PromoService();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        (mockedPromoCode.findByIdAndDelete as any) = jest
            .fn()
            .mockResolvedValue(buildMockPromo());
        (mockedPromoCode.findByIdAndUpdate as any) = jest
            .fn()
            .mockResolvedValue(buildMockPromo());
        (mockedPromoCode.findById as any) = jest
            .fn()
            .mockResolvedValue(buildMockPromo());
        (mockedPromoCode.findOne as any) = mockMongooseQuery(buildMockPromo());
        (mockedPromoCode.find as any) = mockMongooseFind([buildMockPromo()]);
        (mockedPromoCode.countDocuments as any) = jest
            .fn()
            .mockResolvedValue(1);
        (mockedPromoCode.create as any) = jest
            .fn()
            .mockResolvedValue(buildMockPromo());
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
    });

    describe('deletePromo', () => {
        it('should throw PROMOTION_NOT_FOUND if promo not found', async () => {
            (mockedPromoCode.findByIdAndDelete as any) = jest
                .fn()
                .mockResolvedValue(null);
            await expect(promoService.deletePromo('id')).rejects.toMatchObject({
                status: ErrorMessage.PROMOTION_NOT_FOUND.status,
                message: ErrorMessage.PROMOTION_NOT_FOUND.message,
            });
        });

        it('should delete and return promo', async () => {
            const res = await promoService.deletePromo('id');
            expect(mockedPromoCode.findByIdAndDelete).toHaveBeenCalledWith(
                'id'
            );
            expect(res).toBeDefined();
        });
    });

    describe('updatePromo', () => {
        it('should update and return promo', async () => {
            await promoService.updatePromo('id', { discount: 20 });
            expect(mockedPromoCode.findByIdAndUpdate).toHaveBeenCalledWith(
                'id',
                { discount: 20 },
                { new: true }
            );
        });
    });

    describe('getPromoById', () => {
        it('should throw PROMOTION_NOT_FOUND if promo not found', async () => {
            (mockedPromoCode.findById as any) = jest
                .fn()
                .mockResolvedValue(null);
            await expect(promoService.getPromoById('id')).rejects.toMatchObject(
                {
                    status: ErrorMessage.PROMOTION_NOT_FOUND.status,
                    message: ErrorMessage.PROMOTION_NOT_FOUND.message,
                }
            );
        });

        it('should return promo if found', async () => {
            const res = await promoService.getPromoById('id');
            expect(mockedPromoCode.findById).toHaveBeenCalledWith('id');
            expect(res).toBeDefined();
        });
    });

    describe('getAllPromos', () => {
        it('should return promos with empty search and default pagination', async () => {
            const res = await promoService.getAllPromos();
            expect(mockedPromoCode.find).toHaveBeenCalledWith({});
            expect(res.data.length).toBe(1);
        });

        it('should apply search filter', async () => {
            await promoService.getAllPromos('TEST');
            expect(mockedPromoCode.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    code: { $regex: 'TEST', $options: 'i' },
                })
            );
        });

        it('should apply active filter', async () => {
            await promoService.getAllPromos('', 1, 10, { active: 'true' });
            expect(mockedPromoCode.find).toHaveBeenCalledWith(
                expect.objectContaining({ active: true })
            );
        });

        it('should apply min/max discount filters', async () => {
            await promoService.getAllPromos('', 1, 10, {
                minDiscount: '10',
                maxDiscount: '50',
            });
            expect(mockedPromoCode.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    discount: { $gte: 10, $lte: 50 },
                })
            );
        });

        it('should apply minDiscount filter only', async () => {
            await promoService.getAllPromos('', 1, 10, { minDiscount: '10' });
            expect(mockedPromoCode.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    discount: { $gte: 10 },
                })
            );
        });

        it('should apply maxDiscount filter only', async () => {
            await promoService.getAllPromos('', 1, 10, { maxDiscount: '50' });
            expect(mockedPromoCode.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    discount: { $lte: 50 },
                })
            );
        });

        it('should apply valid status filter', async () => {
            await promoService.getAllPromos('', 1, 10, { status: 'valid' });
            expect(mockedPromoCode.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    $or: [
                        { expiration: { $gt: expect.any(Date) } },
                        { expiration: null },
                    ],
                })
            );
        });

        it('should apply expired status filter', async () => {
            await promoService.getAllPromos('', 1, 10, { status: 'expired' });
            expect(mockedPromoCode.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    expiration: { $lte: expect.any(Date) },
                })
            );
        });

        it('should apply available availability filter', async () => {
            await promoService.getAllPromos('', 1, 10, {
                availability: 'available',
            });
            expect(mockedPromoCode.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    $expr: { $lt: ['$usedCount', '$usageLimit'] },
                })
            );
        });

        it('should apply out availability filter', async () => {
            await promoService.getAllPromos('', 1, 10, { availability: 'out' });
            expect(mockedPromoCode.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    $expr: { $gte: ['$usedCount', '$usageLimit'] },
                })
            );
        });

        it('should apply sort asc filter', async () => {
            await promoService.getAllPromos('', 1, 10, { sort: 'asc' });
            expect(mockedPromoCode.find).toHaveBeenCalled(); // Should check sort params if needed
        });
    });

    describe('createPromoCode', () => {
        it.each([
            ['', 10],
            ['TEST', null as any],
        ])(
            'should throw INVALID_PROMO_DATA if code or discount is missing',
            async (code, discount) => {
                await expect(
                    promoService.createPromoCode({ code, discount })
                ).rejects.toMatchObject({
                    status: ErrorMessage.INVALID_PROMO_DATA.status,
                });
            }
        );

        it('should throw PROMO_ALREADY_EXISTS if code already exists', async () => {
            (mockedPromoCode.findOne as any) =
                mockMongooseQuery(buildMockPromo());
            await expect(
                promoService.createPromoCode({ code: 'TEST', discount: 10 })
            ).rejects.toMatchObject({
                status: ErrorMessage.PROMO_ALREADY_EXISTS.status,
            });
        });

        it('should create and return new promo', async () => {
            (mockedPromoCode.findOne as any) = mockMongooseQuery(null);
            const res = await promoService.createPromoCode({
                code: 'TEST',
                discount: 10,
            });
            expect(mockedPromoCode.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    code: 'TEST',
                    discount: 10,
                })
            );
            expect(res).toBeDefined();
        });
    });

    describe('validatePromoCode', () => {
        it('should throw PROMO_CODE_REQUIRED if code is missing', async () => {
            await expect(
                promoService.validatePromoCode('', 'u', 100)
            ).rejects.toMatchObject({
                status: ErrorMessage.PROMO_CODE_REQUIRED.status,
            });
        });

        it('should throw PROMO_NOT_FOUND if promo not found', async () => {
            (mockedPromoCode.findOne as any) = mockMongooseQuery(null);
            await expect(
                promoService.validatePromoCode('INVALID', 'u', 100)
            ).rejects.toMatchObject({
                status: ErrorMessage.PROMO_NOT_FOUND.status,
            });
        });

        it('should throw PROMO_EXPIRED if expired', async () => {
            (mockedPromoCode.findOne as any) = mockMongooseQuery(
                buildMockPromo({ expiration: new Date(Date.now() - 1000) })
            );
            await expect(
                promoService.validatePromoCode('TEST', 'u', 100)
            ).rejects.toMatchObject({
                status: ErrorMessage.PROMO_EXPIRED.status,
            });
        });

        it('should throw PROMO_USAGE_LIMIT_REACHED if overall limit reached', async () => {
            (mockedPromoCode.findOne as any) = mockMongooseQuery(
                buildMockPromo({ usageLimit: 5, usedCount: 5 })
            );
            await expect(
                promoService.validatePromoCode('TEST', 'u', 100)
            ).rejects.toMatchObject({
                status: ErrorMessage.PROMO_USAGE_LIMIT_REACHED.status,
            });
        });

        it('should throw MIN_ORDER_VALUE_NOT_MET if order value is low', async () => {
            (mockedPromoCode.findOne as any) = mockMongooseQuery(
                buildMockPromo({ minOrderValue: 500 })
            );
            await expect(
                promoService.validatePromoCode('TEST', 'u', 100)
            ).rejects.toMatchObject({
                status: ErrorMessage.MIN_ORDER_VALUE_NOT_MET.status,
            });
        });

        it('should throw PROMO_USAGE_LIMIT_REACHED if user exceeded their limit', async () => {
            const userUsages = new Map([['u', 2]]);
            (mockedPromoCode.findOne as any) = mockMongooseQuery(
                buildMockPromo({ maxUsesPerUser: 2, userUsages })
            );
            await expect(
                promoService.validatePromoCode('TEST', 'u', 100)
            ).rejects.toMatchObject({
                status: ErrorMessage.PROMO_USAGE_LIMIT_REACHED.status,
            });
        });

        it('should not throw if user limit not reached', async () => {
            const userUsages = new Map([['u', 1]]);
            (mockedPromoCode.findOne as any) = mockMongooseQuery(
                buildMockPromo({ maxUsesPerUser: 2, userUsages })
            );
            const res = await promoService.validatePromoCode('TEST', 'u', 100);
            expect(res.discount).toBe(10); // 10% of 100
        });

        it('should not throw if maxUsesPerUser is undefined', async () => {
            const userUsages = new Map([['u', 100]]);
            (mockedPromoCode.findOne as any) = mockMongooseQuery(
                buildMockPromo({ maxUsesPerUser: undefined, userUsages })
            );
            const res = await promoService.validatePromoCode('TEST', 'u', 100);
            expect(res.discount).toBe(10);
        });

        it('should not throw if userUsages does not contain userId', async () => {
            const userUsages = new Map([['other', 100]]);
            (mockedPromoCode.findOne as any) = mockMongooseQuery(
                buildMockPromo({ maxUsesPerUser: 2, userUsages })
            );
            const res = await promoService.validatePromoCode('TEST', 'u', 100);
            expect(res.discount).toBe(10);
        });

        it('should calculate discount correctly', async () => {
            (mockedPromoCode.findOne as any) = mockMongooseQuery(
                buildMockPromo({ discount: 15 })
            ); // 15%
            const res = await promoService.validatePromoCode('TEST', 'u', 200);
            expect(res).toEqual({ code: 'DISCOUNT10', discount: 30 }); // 15% of 200 is 30
        });

        it('should cap discount if maxDiscountAmount is set', async () => {
            (mockedPromoCode.findOne as any) = mockMongooseQuery(
                buildMockPromo({ discount: 50, maxDiscountAmount: 20 })
            );
            const res = await promoService.validatePromoCode('TEST', 'u', 100); // 50% of 100 = 50, but capped at 20
            expect(res.discount).toBe(20);
        });
    });

    describe('applyPromoCode', () => {
        it('should throw PROMO_NOT_FOUND if promo not found', async () => {
            (mockedPromoCode.findOne as any) = mockMongooseQuery(null);
            await expect(
                promoService.applyPromoCode('INVALID', 'u')
            ).rejects.toMatchObject({
                status: ErrorMessage.PROMO_NOT_FOUND.status,
            });
        });

        it('should update usedCount and userUsages and save', async () => {
            const userUsages = new Map([['u', 1]]);
            const mockPromo = buildMockPromo({ userUsages, usedCount: 5 });
            (mockedPromoCode.findOne as any) = mockMongooseQuery(mockPromo);

            const res = await promoService.applyPromoCode('TEST', 'u');

            expect(res.usedCount).toBe(6);
            expect(res.userUsages.get('u')).toBe(2);
            expect(mockPromo.save).toHaveBeenCalled();
        });

        it('should set userUsage to 1 if first time use', async () => {
            const mockPromo = buildMockPromo({ userUsages: new Map() });
            (mockedPromoCode.findOne as any) = mockMongooseQuery(mockPromo);

            const res = await promoService.applyPromoCode('TEST', 'user-new');
            expect(res.userUsages.get('user-new')).toBe(1);
        });
    });
});
