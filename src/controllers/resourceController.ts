// controllers/resourceController.ts
import { Request, Response } from 'express';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import resourceService from '~/services/transcription/resourceService.js';
import { knowledgeBaseService } from '~/services/knowledgeBase/knowledgeBaseService.js';

class ResourceController {
    public getResourceById = async (req: Request, res: Response) => {
        const { id } = req.params;
        const resource = await resourceService.getResourceById(id);

        if (!resource) {
            throw new ApiError(ErrorMessage.RESOURCE_NOT_FOUND);
        }

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, resource));
    };

    public updateResourceHandler = async (req: Request, res: Response) => {
        const { id } = req.params;
        const updateData = req.body;

        const updated = await resourceService.updateResource(id, updateData);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.UPDATE_SUCCESS, updated));
    };

    public deleteResourceHandler = async (req: Request, res: Response) => {
        const { id } = req.params;
        await resourceService.deleteResource(id);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.DELETE_SUCCESS));
    };

    public triggerRssHandler = async (req: Request, res: Response) => {
        const newResources = await resourceService.fetchAndSaveAllRss();
        return res
            .status(201)
            .json(new ApiResponse(SuccessMessage.CREATE_SUCCESS, newResources));
    };

    public getTranscriptHanlder = async (req: Request, res: Response) => {
        const { url } = req.body;
        const transcript = await resourceService.fetchTranscript(url);
        // console.log(url);
        // console.log(transcript);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, transcript));
    };

    // Lấy transcript, phân tích bằng LLM và lưu vào Resource
    public saveTranscriptHandler = async (req: Request, res: Response) => {
        const { url } = req.body;
        const resource = await resourceService.saveTranscriptAsResource(url);
        return res
            .status(201)
            .json(new ApiResponse(SuccessMessage.CREATE_SUCCESS, resource));
    };

    /**
     * Tạo bài viết mới (Admin) - hỗ trợ upload file
     */
    public createArticle = async (req: Request, res: Response) => {
        const {
            title,
            content,
            summary,
            thumbnail,
            attachmentUrl,
            attachmentName,
            labels,
            suitableForLearners,
        } = req.body;

        if (!title || !content) {
            throw new ApiError({
                message: 'Title and content are required',
                status: 400,
            });
        }

        const article = await resourceService.createArticle({
            title,
            content,
            summary,
            thumbnail,
            attachmentUrl,
            attachmentName,
            labels,
            suitableForLearners: suitableForLearners === true,
            createdBy: req.user?.id || '',
        });

        return res
            .status(201)
            .json(new ApiResponse(SuccessMessage.CREATE_SUCCESS, article));
    };

    /**
     * Cập nhật bài viết (Admin) - hỗ trợ upload file mới
     */
    public updateArticle = async (req: Request, res: Response) => {
        const { id } = req.params;
        const {
            title,
            content,
            summary,
            thumbnail,
            attachmentUrl,
            attachmentName,
            labels,
            suitableForLearners,
        } = req.body;

        const updateData: Record<string, unknown> = {};
        if (title) updateData.title = title;
        if (content) updateData.content = content;
        if (summary) updateData.summary = summary;
        if (thumbnail) updateData.thumbnail = thumbnail;
        if (attachmentUrl !== undefined)
            updateData.attachmentUrl = attachmentUrl;
        if (attachmentName !== undefined)
            updateData.attachmentName = attachmentName;
        if (labels) updateData.labels = labels;
        if (suitableForLearners !== undefined) {
            updateData.suitableForLearners = suitableForLearners === true;
        }

        const updated = await resourceService.updateArticle(id, updateData);
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.UPDATE_SUCCESS, updated));
    };

    /**
     * Re-index tất cả articles vào knowledge base
     */
    public reindexKnowledge = async (req: Request, res: Response) => {
        const result = await knowledgeBaseService.reindexAllArticles();
        return res
            .status(200)
            .json(new ApiResponse('Reindex completed', result));
    };

    /**
     * Query knowledge base
     */
    public queryKnowledge = async (req: Request, res: Response) => {
        const { query, topK } = req.body;

        if (!query) {
            throw new ApiError({
                message: 'Query is required',
                status: 400,
            });
        }

        const results = await knowledgeBaseService.queryKnowledge({
            query,
            topK,
        });

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, results));
    };

    public searchResource = async (req: Request, res: Response) => {
        const { page, limit, ...filters } = req.query;

        let sortOption: Record<string, 1 | -1> = { createdAt: -1 };
        if (filters.sort === 'newest') sortOption = { publishedAt: -1 };

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);

        if (isNaN(pageNum) || isNaN(limitNum)) {
            throw new ApiError(ErrorMessage.INVALID_PAGE_LIMIT);
        }

        // Convert Express query params to proper string record
        const filterRecord: Record<string, string> = {};
        Object.keys(filters).forEach((key) => {
            const value = filters[key];
            if (typeof value === 'string') {
                filterRecord[key] = value;
            }
        });

        const result = await resourceService.searchResource(
            filterRecord,
            pageNum,
            limitNum,
            sortOption
        );
        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));
    };
}

export const resourceController = new ResourceController();
