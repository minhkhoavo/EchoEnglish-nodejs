import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

class SpeechAssessmentService {
    async assess(buffer: Buffer, mimeType: string): Promise<any> {
        const key = process.env.SPEECH_KEY;
        const region = process.env.SPEECH_REGION;
        if (!key || !region) throw new Error('Missing SPEECH_KEY or SPEECH_REGION');

        const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
        speechConfig.speechRecognitionLanguage = 'en-US';
        speechConfig.outputFormat = sdk.OutputFormat.Detailed;
        const anyCfg = speechConfig as any;
        if (typeof anyCfg.requestWordLevelTimestamps === 'function') anyCfg.requestWordLevelTimestamps();

        let audioConfig: sdk.AudioConfig;
        const isWav = /wav|wave/i.test(mimeType);
        const isMp3 = /mp3/i.test(mimeType);
        if (isWav) {
            audioConfig = sdk.AudioConfig.fromWavFileInput(buffer);
        } else if (isMp3) {
            const pushStream = sdk.AudioInputStream.createPushStream();
            const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            pushStream.write(ab as ArrayBuffer);
            pushStream.close();
            audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
        } else {
            throw new Error('Only WAV or MP3 is supported');
        }

        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

        const paConfigJson = {
            referenceText: '',
            gradingSystem: 'HundredMark',
            granularity: 'Phoneme',
            phonemeAlphabet: 'IPA',
            nBestPhonemeCount: 1,
            enableMiscue: true,
            enableProsodyAssessment: true,
        };

        const paConfig = sdk.PronunciationAssessmentConfig.fromJSON(JSON.stringify(paConfigJson));
        paConfig.enableProsodyAssessment = true;
        paConfig.applyTo(recognizer);

        const result = await new Promise<sdk.SpeechRecognitionResult>((resolve, reject) => {
            recognizer.recognizeOnceAsync(
                (r) => resolve(r),
                (err) => reject(err)
            );
        });

        recognizer.close();

        const raw = result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
        if (!raw) {
            return {
                Reason: result.reason,
                ErrorDetails: (result as any).errorDetails || null,
            };
        }
        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    }
}

export default new SpeechAssessmentService();
