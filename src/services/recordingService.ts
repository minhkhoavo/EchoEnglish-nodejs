import { Types } from 'mongoose';
import RecordingModel, { IRecording } from '~/models/recordingModel.js';

class RecordingService {
    async create(payload: Omit<IRecording, 'createdAt'>) {
        const doc = await RecordingModel.create(payload);
        return doc.toObject();
    }

    async list(params: { userId?: string | Types.ObjectId }) {
        const { userId } = params;
        const filter: { userId?: string | Types.ObjectId } = {};
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

    async getRecordingSummary(
        id: string | Types.ObjectId
    ): Promise<object | null> {
        const recording = await RecordingModel.findById(id).lean();
        if (!recording || !recording.analysis) {
            return null;
        }

        const { analysis, transcript } = recording;
        const analysisData = analysis as Record<string, unknown>;
        const overall = analysisData.overall as Record<string, unknown>;
        const analyses = analysisData.analyses as Record<string, unknown>;
        const segments = analysisData.segments as Array<
            Record<string, unknown>
        >;
        const allWords =
            (segments?.[0]?.words as Array<Record<string, unknown>>) ?? [];

        const pronunciationMistakes: string[] = [];
        const lowAccuracyWords = allWords.filter(
            (word: Record<string, unknown>) => (word.accuracy as number) < 50
        );
        if (lowAccuracyWords.length > 0) {
            const words = lowAccuracyWords
                .map((w: Record<string, unknown>) => `'${w.word as string}'`)
                .join(', ');
            pronunciationMistakes.push(
                `Pronunciation accuracy was low for the following words: ${words}.`
            );
        }

        // Detect unpronounced word endings
        const unpronouncedEndings = allWords.filter(
            (word: Record<string, unknown>) =>
                ((word.word as string).endsWith('ed') ||
                    (word.word as string).endsWith('s')) &&
                word.actualPronunciation &&
                !(word.actualPronunciation as string).endsWith('t/') &&
                !(word.actualPronunciation as string).endsWith('d/') &&
                !(word.actualPronunciation as string).endsWith('s/') &&
                !(word.actualPronunciation as string).endsWith('z/')
        );

        if (unpronouncedEndings.length > 0) {
            const words = unpronouncedEndings
                .map((w: Record<string, unknown>) => `'${w.word as string}'`)
                .join(', ');
            pronunciationMistakes.push(
                `Final sound mistake: The final sound is not pronounced clearly in the words: ${words}.`
            );
        }

        // Detect other pronunciation errors
        const wordsWithErrors = allWords.filter(
            (word: Record<string, unknown>) =>
                word.errors &&
                Array.isArray(word.errors) &&
                (word.errors as Array<unknown>).length > 0
        );
        if (wordsWithErrors.length > 0) {
            wordsWithErrors.forEach((word: Record<string, unknown>) => {
                const errors = word.errors as Array<Record<string, unknown>>;
                const errorTypes = errors
                    .map(
                        (error: Record<string, unknown>) => error.type as string
                    )
                    .join(', ');
                pronunciationMistakes.push(
                    `The word '${word.word as string}' has the following error(s): ${errorTypes}.`
                );
            });
        }

        // 2. Fluency
        const fluencyIssues: string[] = [];
        const duplicatedWords = allWords.filter(
            (word: Record<string, unknown>) => word.isDuplicated as boolean
        );
        if (duplicatedWords.length > 0) {
            const words = duplicatedWords
                .map((w: Record<string, unknown>) => `'${w.word as string}'`)
                .join(', ');
            fluencyIssues.push(
                `Repetition error: The following words were repeated: ${words}.`
            );
        }

        return {
            transcript: transcript || '',
            quantitativeMetrics: {
                pronunciationScore: (overall?.PronScore as number) ?? 0,
                fluencyScore: (overall?.FluencyScore as number) ?? 0,
                prosodyScore: (overall?.ProsodyScore as number) ?? 0,
                wordsPerMinute:
                    ((analyses?.fluency as Record<string, unknown>)
                        ?.words_per_minute as number) ?? 0,
            },
            qualitativeAnalysis: {
                pronunciationMistakes,
                fluencyIssues,
            },
        };
    }

    async remove(id: string | Types.ObjectId) {
        return RecordingModel.findByIdAndDelete(id).lean();
    }

    async update(id: string | Types.ObjectId, patch: Partial<IRecording>) {
        return RecordingModel.findByIdAndUpdate(
            id,
            { $set: patch },
            { new: true }
        ).lean();
    }
}

export default new RecordingService();
