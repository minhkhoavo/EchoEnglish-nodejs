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

  async getRecordingSummary(
    id: string | Types.ObjectId
  ): Promise<object | null> {
    const recording = await RecordingModel.findById(id).lean();
    if (!recording || !recording.analysis) {
      return null;
    }

    const { analysis, transcript } = recording;
    const { overall, analyses, segments } = analysis;
    const allWords = segments?.[0]?.words ?? [];

    const pronunciationMistakes: string[] = [];
    const lowAccuracyWords = allWords.filter((word: any) => word.accuracy < 50);
    if (lowAccuracyWords.length > 0) {
      const words = lowAccuracyWords.map((w: any) => `'${w.word}'`).join(', ');
      pronunciationMistakes.push(
        `Pronunciation accuracy was low for the following words: ${words}.`
      );
    }

    // Detect unpronounced word endings
    const unpronouncedEndings = allWords.filter(
      (word: any) =>
        (word.word.endsWith('ed') || word.word.endsWith('s')) &&
        word.actualPronunciation &&
        !word.actualPronunciation.endsWith('t/') &&
        !word.actualPronunciation.endsWith('d/') &&
        !word.actualPronunciation.endsWith('s/') &&
        !word.actualPronunciation.endsWith('z/')
    );

    if (unpronouncedEndings.length > 0) {
      const words = unpronouncedEndings
        .map((w: any) => `'${w.word}'`)
        .join(', ');
      pronunciationMistakes.push(
        `Final sound mistake: The final sound is not pronounced clearly in the words: ${words}.`
      );
    }

    // 2. Fluency
    const fluencyIssues: string[] = [];
    if (analyses?.fluency?.feedbacks) {
      const pauses = analyses.fluency.feedbacks.filter(
        (f: any) => f.correctness === 'incorrect' || f.correctness === 'warning'
      );
      if (pauses.length > 0) {
        fluencyIssues.push(
          `There are ${pauses.length} instances of hesitation or unnatural pauses detected.`
        );
      }
    }
    const duplicatedWords = allWords.filter((word: any) => word.isDuplicated);
    if (duplicatedWords.length > 0) {
      const words = duplicatedWords.map((w: any) => `'${w.word}'`).join(', ');
      fluencyIssues.push(
        `Repetition error: The following words were repeated: ${words}.`
      );
    }

    return {
      transcript: transcript || '',
      quantitativeMetrics: {
        pronunciationScore: overall?.PronScore ?? 0,
        fluencyScore: overall?.FluencyScore ?? 0,
        prosodyScore: overall?.ProsodyScore ?? 0,
        wordsPerMinute: analyses?.fluency?.words_per_minute ?? 0,
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
