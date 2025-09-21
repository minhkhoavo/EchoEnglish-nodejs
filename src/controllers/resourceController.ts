// controllers/resourceController.ts
import { Request, Response } from "express";
import ApiResponse from "~/dto/response/apiResponse";
import { ErrorMessage } from "~/enum/errorMessage";
import { SuccessMessage } from "~/enum/successMessage";
import { ApiError } from "~/middleware/apiError";
import { Role } from "~/models/roleModel";
import resourceService from "~/services/transcription/resourceService";
import UserService from "~/services/userService";

class ResourceController {

  private userService = new UserService();

  public updateResourceHandler = async (req: Request, res: Response) => {
    const { id } = req.params;
    const updateData = req.body;

    const updated = await resourceService.updateResource(id, updateData);
    return res.status(200).json(new ApiResponse(SuccessMessage.UPDATE_SUCCESS, updated));
  };

  public deleteResourceHandler = async (req: Request, res: Response) => {
    const { id } = req.params;
    await resourceService.deleteResource(id);
    return res.status(200).json(new ApiResponse(SuccessMessage.DELETE_SUCCESS, null));
  };

  public triggerRssHandler = async (req: Request, res: Response) => {
    const { feedUrl } = req.body;
    const newResources = await resourceService.fetchAndSaveRss(feedUrl);
    return res.status(201).json(new ApiResponse(SuccessMessage.CREATE_SUCCESS, newResources));
  };

  public getTranscriptHanlder = async (req: Request, res: Response) => {
    const { url } = req.body;
    const transcript = await resourceService.fetchTranscript(url);
    console.log(url);
    console.log(transcript);
    return res.status(200).json(new ApiResponse(SuccessMessage.GET_SUCCESS, transcript));
  }
  
      // Lấy transcript, phân tích bằng LLM và lưu vào Resource
  public saveTranscriptHandler = async (req: Request, res: Response) => {
    const { url } = req.body;
    const resource = await resourceService.saveTranscriptAsResource(url);
    return res.status(201).json(new ApiResponse(SuccessMessage.CREATE_SUCCESS, resource));
  };

  public searchResource = async (req: Request, res: Response) => {
    const {page, limit, ...filters} = req.query;

    const isAdmin = await this.userService.isAdmin(req?.user?.scope!);
    console.log(req.user?.scope);

    let sortOption: any;
    if(filters.sort === "newest")
      sortOption = { publishedAt: -1 };

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    if (isNaN(pageNum) || isNaN(limitNum)) {
      throw new ApiError(ErrorMessage.INVALID_PAGE_LIMIT);
    }

    const result = await resourceService.searchResource(isAdmin, filters, pageNum, limitNum, sortOption);
    return res.status(200).json(new ApiResponse(SuccessMessage.GET_SUCCESS, result));

  }
}

export const resourceController = new ResourceController();
