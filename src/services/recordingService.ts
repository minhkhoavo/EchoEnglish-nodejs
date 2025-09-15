import { Types } from 'mongoose';
import RecordingModel, { IRecording } from '~/models/recordingModel';

class RecordingService {
    async create(payload: Omit<IRecording, 'createdAt'>) {
        const doc = await RecordingModel.create(payload);
        return doc.toObject();
    }

    async list(params: { userId?: string | Types.ObjectId }) {
        const { userId } = params;
        const filter: any = {};
        if (userId) filter.userId = userId;

        const items = await RecordingModel.find(filter)
            .select('-analysis')
            .sort({ createdAt: -1 })
            .lean();

        return {
            items,
        };
    }

    async getById(id: string | Types.ObjectId) {
        return RecordingModel.findById(id).lean();
    }

    async remove(id: string | Types.ObjectId) {
        return RecordingModel.findByIdAndDelete(id).lean();
    }

    async update(id: string | Types.ObjectId, patch: Partial<IRecording>) {
        return RecordingModel.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
    }
}

export default new RecordingService();
