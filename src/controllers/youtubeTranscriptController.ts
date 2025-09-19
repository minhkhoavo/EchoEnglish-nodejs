import { Request, Response } from "express";
import ApiResponse from "~/dto/response/apiResponse";
import { SuccessMessage } from "~/enum/successMessage";
import youtubeService from "~/services/transcription/youtubeTranscriptService";
class YoutubeTranscriptController {
    // Lấy transcript từ Youtube
    public getTranscriptHanlder = async (req: Request, res: Response) => {
        const { url } = req.body;
        const transcript = await youtubeService.fetchTranscript(url);
        console.log(url);
        console.log(transcript);
        return res.status(200).json(new ApiResponse(SuccessMessage.GET_SUCCESS, transcript));
    }

    // Lấy transcript, phân tích bằng LLM và lưu vào Resource
    public saveTranscriptHandler = async (req: Request, res: Response) => {
        const { url } = req.body;
        const resource = await youtubeService.saveTranscriptAsResource(url);
        return res.status(201).json(new ApiResponse(SuccessMessage.CREATE_SUCCESS, resource));
    };
}

export default new YoutubeTranscriptController();