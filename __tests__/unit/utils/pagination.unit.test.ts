/* eslint-disable @typescript-eslint/no-explicit-any */
import { PaginationHelper } from '~/utils/pagination.js';

describe('PaginationHelper', () => {
    describe('paginate', () => {
        it('should paginate correctly', async () => {
            const mockModel = {
                find: jest.fn().mockReturnThis(),
                populate: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                sort: jest.fn().mockReturnThis(),
                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(['item1', 'item2']),
                countDocuments: jest.fn().mockResolvedValue(10),
            };

            const options = { page: 2, limit: 2 };
            const query = { active: true };
            const result = await PaginationHelper.paginate(
                mockModel as any,
                query,
                options,
                { path: 'author' } as any,
                '-__v',
                { createdAt: -1 }
            );

            expect(mockModel.find).toHaveBeenCalledWith(query);
            expect(mockModel.populate).toHaveBeenCalledWith({ path: 'author' });
            expect(mockModel.select).toHaveBeenCalledWith('-__v');
            expect(mockModel.sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(mockModel.skip).toHaveBeenCalledWith(2);
            expect(mockModel.limit).toHaveBeenCalledWith(2);
            expect(mockModel.lean).toHaveBeenCalled();

            expect(result).toEqual({
                data: ['item1', 'item2'],
                pagination: {
                    total: 10,
                    page: 2,
                    limit: 2,
                    totalPages: 5,
                    hasNext: true,
                    hasPrev: true,
                },
            });
        });

        it('should use default values for populate, select, and sort if not provided', async () => {
            const mockModel = {
                find: jest.fn().mockReturnThis(),
                populate: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                sort: jest.fn().mockReturnThis(),
                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(['item1']),
                countDocuments: jest.fn().mockResolvedValue(1),
            };

            const options = { page: 1, limit: 10 };
            const query = {};
            const result = await PaginationHelper.paginate(
                mockModel as any,
                query,
                options
            );

            expect(mockModel.populate).toHaveBeenCalledWith([]);
            expect(mockModel.select).toHaveBeenCalledWith('-__v');
            expect(mockModel.sort).toHaveBeenCalledWith({});
            expect(mockModel.skip).toHaveBeenCalledWith(0);

            expect(result.pagination).toEqual({
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1,
                hasNext: false,
                hasPrev: false,
            });
        });

        it('should handle falsy select and sort properly', async () => {
            const mockModel = {
                find: jest.fn().mockReturnThis(),
                populate: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                sort: jest.fn().mockReturnThis(),
                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                lean: jest.fn().mockResolvedValue(['item1']),
                countDocuments: jest.fn().mockResolvedValue(1),
            };

            const options = { page: 1, limit: 10 };
            const query = {};
            await PaginationHelper.paginate(
                mockModel as any,
                query,
                options,
                undefined,
                ''
            );

            expect(mockModel.select).toHaveBeenCalledWith('');
        });
    });
});
