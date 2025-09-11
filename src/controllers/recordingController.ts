import { Request, Response, NextFunction } from 'express';
import RecordingService from '~/services/recordingService';
import ApiResponse from '~/dto/response/apiResponse';
import { ApiError } from '~/middleware/apiError';

class RecordingController {
    async list(req: Request, res: Response, next: NextFunction) {
        const userId = (req.user as any)?.id || (req as any).userId;

        const data = await RecordingService.list({ userId });
        res.status(200).json(new ApiResponse('OK', data));
    }

    async detail(req: Request, res: Response, next: NextFunction) {
        const rec = await RecordingService.getById(req.params.id);
        if (!rec) throw new ApiError({ message: 'Recording not found', status: 404 });
        res.status(200).json(new ApiResponse('OK', rec));
    }

    async remove(req: Request, res: Response, next: NextFunction) {
        const rec = await RecordingService.remove(req.params.id);
        if (!rec) throw new ApiError({ message: 'Recording not found', status: 404 });
        res.status(200).json(new ApiResponse('Deleted', rec));
    }
}

export default new RecordingController();
