// controllers/resourceController.ts
import { Request, Response } from 'express';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import resourceService from '~/services/transcription/resourceService.js';
import UserService from '~/services/userService.js';

class ResourceController {
  private userService = new UserService();

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
      .json(new ApiResponse(SuccessMessage.DELETE_SUCCESS, null));
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
    console.log(url);
    console.log(transcript);
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

  public searchResource = async (req: Request, res: Response) => {
    const { page, limit, ...filters } = req.query;

    const userScope = req?.user?.scope;
    if (!userScope) {
      throw new ApiError(ErrorMessage.UNAUTHORIZED);
    }
    const isAdmin = await this.userService.isAdmin(userScope);
    console.log(req.user?.scope);

    let sortOption: Record<string, 1 | -1> = {};
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
      isAdmin,
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
