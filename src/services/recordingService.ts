import RecordingModel, { IRecording } from '~/models/recordingModel';

class RecordingService {
    async create(payload: Omit<IRecording, 'createdAt'>) {
        const doc = await RecordingModel.create(payload);
        return doc.toObject();
    }

    async list(params: { userId?: string }) {
        const { userId } = params;
        const filter: any = {};
        if (userId) filter.userId = userId;

        const items = await RecordingModel.find(filter).sort({ createdAt: -1 }).lean();

        return {
            items,
        };
    }

    async getById(id: string) {
        return RecordingModel.findById(id).lean();
    }

    async remove(id: string) {
        return RecordingModel.findByIdAndDelete(id).lean();
    }
}

export default new RecordingService();
