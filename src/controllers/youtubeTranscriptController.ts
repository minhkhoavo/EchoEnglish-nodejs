import { Request, Response } from 'express';
import ApiResponse from '~/dto/response/apiResponse';
import { SuccessMessage } from '~/enum/successMessage';
import youtubeService from '~/services/transcription/youtubeTranscriptService';
class YoutubeTranscriptController {
  public getTranscriptHanlder = async (req: Request, res: Response) => {
    const { url } = req.body;
    const transcript = await youtubeService.fetchTranscript(url);
    console.log(url);
    console.log(transcript);
    return res
      .status(200)
      .json(new ApiResponse(SuccessMessage.GET_SUCCESS, transcript));
  };
}

export default new YoutubeTranscriptController();
