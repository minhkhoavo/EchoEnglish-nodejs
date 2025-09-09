import wav from 'node-wav';

// Simple helpers
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const std = (arr: number[], m = mean(arr)) => Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
const normalize = (val: number, min: number, max: number) => (max === min ? 0 : (val - min) / (max - min));

function rms(samples: Float32Array | number[]) {
    if (!samples || samples.length === 0) return 0;
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
    return Math.sqrt(sumSq / samples.length);
}

// Autocorrelation-based pitch estimator (YIN-lite)
function estimatePitchHz(frame: Float32Array, sampleRate: number, minHz = 50, maxHz = 500): number | null {
    if (frame.length < sampleRate / minHz) return null;
    const minLag = Math.floor(sampleRate / maxHz);
    const maxLag = Math.floor(sampleRate / minHz);

    let bestLag = -1;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let corr = 0;
        for (let i = 0; i < frame.length - lag; i++) {
            corr += frame[i] * frame[i + lag];
        }
        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }
    if (bestLag <= 0) return null;
    const freq = sampleRate / bestLag;
    if (!isFinite(freq) || freq <= 0) return null;
    return freq;
}

export type ProsodyPoint = { time: number; value: number };
export type ProsodyAnalysis = {
    pitch_range_min: number;
    pitch_range_max: number;
    energy_range_min: number;
    energy_range_max: number;
    pitch_points: ProsodyPoint[]; // time in seconds
    energy_points: ProsodyPoint[]; // time in seconds
};

export type FluencyFeedbackItem = {
    start_time: number; // seconds
    duration: number; // seconds
    start_index: number;
    end_index: number;
    correctness: 'correct' | 'warning' | 'incorrect';
};

export type FluencyAnalysis = {
    words_per_minute: number;
    pausing_score: number;
    pausing_decision: 'correct' | 'warning' | 'incorrect';
    points: ProsodyPoint[]; // time in seconds
    feedbacks: FluencyFeedbackItem[]; // minimal pause markers for UI
};

export type StressWord = { index: number; word: string; stressScore: number; isStressed: boolean };

class SpeechProsodyService {
    // Expect transformed object from SpeechTransformService.createTranscriptData
    analyze({
        azureSegments,
        transformed,
        audioBuffer,
        mimeType,
        userId,
        recordingId,
    }: {
        azureSegments: any[];
        transformed: any;
        audioBuffer: Buffer;
        mimeType: string;
        userId: string;
        recordingId: string;
    }): { prosody: ProsodyAnalysis; fluency: FluencyAnalysis; stressWords: StressWord[] } {
        // If not WAV, we can only do fluency based on timing metadata, skip waveform prosody
        let sampleRate = 0;
        let channel: Float32Array | null = null;
        let totalSeconds = (transformed?.metadata?.duration || 0) / 1000;

        const isWav = /wav|wave/i.test(mimeType);
        if (isWav) {
            try {
                const decoded = wav.decode(audioBuffer);
                sampleRate = decoded.sampleRate;
                channel = decoded.channelData[0];
                if (channel && sampleRate) {
                    totalSeconds = channel.length / sampleRate;
                }
            } catch {}
        }

        // Build word timeline from transformed words (convert ms -> seconds)
        const allWords: { word: string; start: number; end: number; index: number }[] = [];
        let wIndex = 0;
        for (const seg of transformed.segments || []) {
            for (const w of seg.words || []) {
                const startSec = (w.offset || 0) / 1000;
                const endSec = ((w.offset || 0) + (w.duration || 0)) / 1000;
                allWords.push({ word: w.word, start: startSec, end: endSec, index: wIndex++ });
            }
        }

        // Stress words using duration + intensity
        const stressWords: StressWord[] = [];
        const durations = allWords.map((w) => (w.end - w.start) * 1000); // ms (for UI-friendly stress weighting only)
        let intensities: number[] = new Array(allWords.length).fill(0);

        if (channel && sampleRate) {
            intensities = allWords.map((w) => {
                const s = Math.max(0, Math.floor(w.start * sampleRate));
                const e = Math.min(channel!.length, Math.floor(w.end * sampleRate));
                return rms(channel!.subarray(s, e));
            });
        }

        const minDur = Math.min(...durations);
        const maxDur = Math.max(...durations);
        const minRms = Math.min(...intensities);
        const maxRms = Math.max(...intensities);

        const DURATION_WEIGHT = 0.5;
        const INTENSITY_WEIGHT = 0.5;

        const stressScores = allWords.map((w, i) => {
            const nd = normalize(durations[i], minDur, maxDur);
            const nr = normalize(intensities[i], minRms, maxRms);
            return DURATION_WEIGHT * nd + INTENSITY_WEIGHT * nr;
        });
        const m = mean(stressScores);
        const s = std(stressScores, m);
        const threshold = m + 0.75 * s;
        for (let i = 0; i < allWords.length; i++) {
            stressWords.push({
                index: i,
                word: allWords[i].word,
                stressScore: stressScores[i],
                isStressed: stressScores[i] > threshold,
            });
        }

        // Prosody points (pitch and energy) sampled each 0.5s
        const pitch_points: ProsodyPoint[] = [];
        const energy_points: ProsodyPoint[] = [];
        if (channel && sampleRate) {
            const hopSec = 0.5;
            const frameSec = 0.04; // 40ms frame for pitch/energy
            const hop = Math.floor(hopSec * sampleRate);
            const frame = Math.floor(frameSec * sampleRate);
            for (let start = 0; start + frame < channel.length; start += hop) {
                const t = start / sampleRate;
                const window = channel.subarray(start, start + frame);
                const p = estimatePitchHz(window, sampleRate);
                const e = rms(window);
                if (p) pitch_points.push({ time: Number(t.toFixed(2)), value: Number(p.toFixed(2)) });
                energy_points.push({ time: Number(t.toFixed(2)), value: Number((e * 100).toFixed(2)) });
            }
        }

        // Derive variation and ranges
        const pitchVals = pitch_points.map((p) => p.value);
        const energyVals = energy_points.map((p) => p.value);
        const pitchVar = pitchVals.length ? std(pitchVals) : 0;
        const energyVar = energyVals.length ? std(energyVals) : 0;

        const prosody: ProsodyAnalysis = {
            pitch_range_max: pitchVals.length ? Math.max(...pitchVals) : 0,
            pitch_range_min: pitchVals.length ? Math.min(...pitchVals) : 0,
            energy_range_max: energyVals.length ? Math.max(...energyVals) : 0,
            energy_range_min: energyVals.length ? Math.min(...energyVals) : 0,
            pitch_points,
            energy_points,
        };

        // Fluency based on word timings
        const totalWords = allWords.length;
        const words_per_minute = totalSeconds > 0 ? (totalWords / totalSeconds) * 60 : 0;
        const pauseThreshold = 0.5; // seconds
        const pauses: { start: number; duration: number; start_index: number; end_index: number }[] = [];
        for (let i = 1; i < allWords.length; i++) {
            const gap = allWords[i].start - allWords[i - 1].end;
            if (gap >= pauseThreshold) {
                pauses.push({ start: allWords[i - 1].end, duration: gap, start_index: i - 1, end_index: i });
            }
        }

        const pausing_score = clamp(100 - pauses.length * 10, 0, 100);

        const feedbacks: FluencyFeedbackItem[] = pauses.map((p) => ({
            start_time: Number(p.start.toFixed(2)),
            duration: Number(p.duration.toFixed(2)),
            start_index: p.start_index,
            end_index: p.end_index,
            correctness: 'incorrect',
        }));

        let fluency: FluencyAnalysis = {
            words_per_minute: Number(words_per_minute.toFixed(2)),
            pausing_score: Number(pausing_score.toFixed(2)),
            pausing_decision: pauses.length === 0 ? 'correct' : pauses.length <= 2 ? 'warning' : 'incorrect',
            points: (transformed.segments || []).map((s: any) => {
                const durationSec = Math.max(0.001, (s.endTime - s.startTime) / 1000);
                const wpm = ((s.words?.length || 0) / durationSec) * 60;
                return { time: Number((s.endTime / 1000).toFixed(2)), value: Number(wpm.toFixed(2)) };
            }),
            feedbacks,
        };

        // Adaptive downsampling for UI rendering
        const downsample = (pts: ProsodyPoint[], maxPoints: number) => {
            if (pts.length <= maxPoints) return pts;
            const step = Math.ceil(pts.length / maxPoints);
            const out: ProsodyPoint[] = [];
            for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
            if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
            return out;
        };

        // Choose reasonable caps by duration (seconds)
        const maxPoints = totalSeconds < 30 ? 80 : totalSeconds < 120 ? 140 : 200;
        prosody.pitch_points = downsample(prosody.pitch_points, maxPoints);
        prosody.energy_points = downsample(prosody.energy_points, maxPoints);
        fluency.points = downsample(fluency.points, Math.max(10, Math.min(60, Math.round(totalSeconds))));

        // Keep only most relevant pauses: top 5 by duration
        fluency.feedbacks = [...fluency.feedbacks].sort((a, b) => b.duration - a.duration).slice(0, 5);

        return { prosody, fluency, stressWords };
    }
}

export default new SpeechProsodyService();
