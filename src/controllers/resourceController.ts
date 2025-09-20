// controllers/resourceController.ts
import { Request, Response } from "express";
import ApiResponse from "~/dto/response/apiResponse";
import { SuccessMessage } from "~/enum/successMessage";
import resourceService from "~/services/transcription/resourceService";

class ResourceController {
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
}

export const resourceController = new ResourceController();
