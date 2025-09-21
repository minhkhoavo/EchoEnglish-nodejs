import { Document, Model, PopulateOptions } from 'mongoose';

export interface PaginationOptions {
    page: number;
    limit: number;
}

export interface PaginationResult<T> {
    data: T[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
}

export class PaginationHelper {
    static async paginate<T extends Document>(
        model: Model<T>,
        query: any,
        options: PaginationOptions,
        populate?: any,
        select?: string,
        sort?: any
    ): Promise<PaginationResult<T>> {
        const { page, limit } = options;
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            model
                .find(query)
                .populate(populate || '')
                .select(select || '')
                .sort(sort || {})
                .skip(skip)
                .limit(limit)
                .lean(),
            model.countDocuments(query),
        ]);

        const totalPages = Math.ceil(total / limit);

        return {
            data: data as T[],
            pagination: {
                total,
                page,
                limit,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
            },
        };
    }
}
