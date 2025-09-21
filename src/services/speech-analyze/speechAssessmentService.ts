import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import {
  convertMp3ToWav,
  makeAudioConfigFromPcm16kMonoWav,
} from '~/utils/audio-utils';

class SpeechAssessmentService {
  async assess(
    buffer: Buffer,
    mimeType: string,
    referenceText: string = ''
  ): Promise<any[]> {
    const key = process.env.SPEECH_KEY;
    const region = process.env.SPEECH_REGION;
    if (!key || !region) throw new Error('Missing SPEECH_KEY or SPEECH_REGION');

    const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
    speechConfig.speechRecognitionLanguage = 'en-US';
    speechConfig.outputFormat = sdk.OutputFormat.Detailed;
    const anyCfg = speechConfig as any;
    if (typeof anyCfg.requestWordLevelTimestamps === 'function')
      anyCfg.requestWordLevelTimestamps();

    let audioConfig: sdk.AudioConfig;

    const isWavBuffer = (b: Buffer) =>
      b &&
      b.length >= 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WAVE';
    let wavBuffer: Buffer = buffer;
    const isMp3 = /mp3/i.test(mimeType || '');

    if (!isWavBuffer(buffer) || isMp3) {
      try {
        wavBuffer = await convertMp3ToWav(buffer);
      } catch (err) {
        throw new Error(
          `Failed to convert input to WAV: ${(err as any)?.message || err}`
        );
      }
    }

    if (!isWavBuffer(wavBuffer)) {
      throw new Error(
        'Converted audio is not a valid WAV (RIFF/WAVE header missing)'
      );
    }

    try {
      audioConfig = sdk.AudioConfig.fromWavFileInput(wavBuffer);
    } catch (e) {
      console.warn(
        '[Speech] fromWavFileInput failed, falling back to stream input:',
        (e as any)?.message || e
      );
      audioConfig = makeAudioConfigFromPcm16kMonoWav(wavBuffer);
    }

    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    const paConfigJson = {
      referenceText: referenceText,
      gradingSystem: 'HundredMark',
      granularity: 'Phoneme',
      phonemeAlphabet: 'IPA',
      nBestPhonemeCount: 1,
      enableMiscue: true,
      enableProsodyAssessment: true,
    };

    const paConfig = sdk.PronunciationAssessmentConfig.fromJSON(
      JSON.stringify(paConfigJson)
    );
    paConfig.enableProsodyAssessment = true;
    paConfig.applyTo(recognizer);

    return new Promise<any[]>((resolve, reject) => {
      const results: any[] = [];
      let lastPartial: string = '';

      recognizer.sessionStarted = (s, e) => {
        console.log('[Speech] sessionStarted');
      };
      recognizer.sessionStopped = (s, e) => {
        console.log('[Speech] sessionStopped');
      };
      recognizer.speechStartDetected = () =>
        console.log('[Speech] speechStartDetected');
      recognizer.speechEndDetected = () =>
        console.log('[Speech] speechEndDetected');
      recognizer.recognizing = (s, e) => {
        if (e.result?.text) {
          lastPartial = e.result.text;
          // console.log('[Speech] recognizing partial:', e.result.text);
        }
      };
      recognizer.recognized = (s, e) => {
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
          const rawResult = e.result.properties.getProperty(
            sdk.PropertyId.SpeechServiceResponse_JsonResult
          );
          if (rawResult) {
            try {
              results.push(JSON.parse(rawResult));
            } catch (error) {
              console.error(
                'Failed to parse pronunciation assessment result JSON',
                error
              );
            }
          }
        } else if (e.result.reason === sdk.ResultReason.NoMatch) {
          console.warn('[Speech] NoMatch result');
        }
      };
      // sessionStopped moved earlier for logging; still handle promise resolution here
      recognizer.sessionStopped = (s, e) => {
        recognizer.stopContinuousRecognitionAsync(
          () => {
            recognizer.close();
            if (!results.length) {
              console.warn('[Speech] sessionStopped with zero results');
            }
            resolve(results);
          },
          (err) => {
            recognizer.close();
            reject(err);
          }
        );
      };

      recognizer.canceled = (s, e) => {
        const reason = e.reason;
        const code = e.errorCode;
        const details = e.errorDetails;
        const reasonName = sdk.CancellationReason[reason as any] || reason;
        console.error('[Speech] Canceled:', {
          reason,
          reasonName,
          code,
          details,
        });
        let hint = '';
        if (reason === sdk.CancellationReason.Error) {
          if (!details) {
            hint =
              'No errorDetails supplied. Possible causes: invalid subscription key/region, audio format mismatch, empty audio, network issue.';
          } else if (/Forbidden|401|403/i.test(details)) {
            hint = 'Check SPEECH_KEY / SPEECH_REGION environment variables.';
          } else if (/format|header|chunk/i.test(details)) {
            hint = 'Audio format issue. Ensure 16kHz 16-bit mono PCM WAV.';
          }
        } else if (reason === sdk.CancellationReason.EndOfStream) {
          hint = 'Stream ended unexpectedly. Verify the WAV data chunk length.';
        }
        if (hint) console.error('[Speech] Hint:', hint);
        const finish = (err?: any, treatAsSuccess = false) => {
          recognizer.close();
          if (treatAsSuccess) {
            if (!results.length && lastPartial) {
              results.push({
                DisplayText: lastPartial,
                NBest: [
                  {
                    Lexical: lastPartial,
                    ITN: lastPartial,
                    MaskedITN: lastPartial,
                    Display: lastPartial,
                  },
                ],
                RecognitionStatus: 'Success',
                Duration: 0,
              });
            }
            return resolve(results);
          }
          if (err) return reject(err);
          reject(
            new Error(
              `Recognition canceled. reason=${reasonName} code=${code} details=${details || 'n/a'} ${hint}`
            )
          );
        };

        if (reason === sdk.CancellationReason.EndOfStream) {
          console.log(
            '[Speech] Treating EndOfStream as graceful end. Using collected results / partials.'
          );
          return finish(undefined, true);
        }

        recognizer.stopContinuousRecognitionAsync(
          () => finish(),
          (err) => finish(err)
        );
      };

      recognizer.startContinuousRecognitionAsync(
        () => {
          console.log('Recognition started');
        },
        (err) => {
          recognizer.close();
          reject(err);
        }
      );
    });
  }
}

export default new SpeechAssessmentService();
