import { Schema, model, Types } from 'mongoose';

export interface IRecording {
    userId?: Types.ObjectId;
    name: string;
    url: string;
    duration: number;
    speakingTime: number;
    mimeType?: string;
    size?: number;
    transcript?: string;
    createdAt: Date;
}

const RecordingSchema = new Schema<IRecording>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        name: { type: String, required: true },
        url: { type: String, required: true },
        duration: { type: Number, required: true },
        speakingTime: { type: Number, required: true },
        mimeType: { type: String },
        size: { type: Number },
        transcript: { type: String },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

export default model<IRecording>('Recording', RecordingSchema);
