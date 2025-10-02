class SpeechTransformService {
    private extractErrors(
        pronAssessment: unknown
    ): Array<Record<string, unknown>> {
        const errors: Array<Record<string, unknown>> = [];
        const errorType = (pronAssessment as Record<string, unknown>)
            ?.ErrorType;
        if (!errorType || errorType === 'None') return errors;
        switch (errorType) {
            case 'Mispronunciation':
                errors.push({
                    type: 'mispronunciation',
                    confidence: Math.round(
                        100 -
                            (((pronAssessment as Record<string, unknown>)
                                ?.AccuracyScore as number) || 0)
                    ),
                });
                break;
            case 'UnexpectedBreak': {
                const assessment = pronAssessment as Record<string, unknown>;
                const feedback = assessment?.Feedback as Record<
                    string,
                    unknown
                >;
                const prosody = feedback?.Prosody as Record<string, unknown>;
                const breakData = prosody?.Break as Record<string, unknown>;
                const unexpectedBreak = breakData?.UnexpectedBreak as Record<
                    string,
                    unknown
                >;
                const unexpectedBreakConfidence = unexpectedBreak?.Confidence;
                if (typeof unexpectedBreakConfidence === 'number')
                    errors.push({
                        type: 'unexpected_break',
                        confidence: Math.round(unexpectedBreakConfidence * 100),
                    });
                break;
            }
            case 'MissingBreak': {
                const assessment = pronAssessment as Record<string, unknown>;
                const feedback = assessment?.Feedback as Record<
                    string,
                    unknown
                >;
                const prosody = feedback?.Prosody as Record<string, unknown>;
                const breakData = prosody?.Break as Record<string, unknown>;
                const missingBreak = breakData?.MissingBreak as Record<
                    string,
                    unknown
                >;
                const missingBreakConfidence = missingBreak?.Confidence;
                if (typeof missingBreakConfidence === 'number')
                    errors.push({
                        type: 'missing_break',
                        confidence: Math.round(missingBreakConfidence * 100),
                    });
                break;
            }
            case 'Monotone': {
                const assessment = pronAssessment as Record<string, unknown>;
                const feedback = assessment?.Feedback as Record<
                    string,
                    unknown
                >;
                const prosody = feedback?.Prosody as Record<string, unknown>;
                const intonation = prosody?.Intonation as Record<
                    string,
                    unknown
                >;
                const monotone = intonation?.Monotone as Record<
                    string,
                    unknown
                >;
                const monotoneConfidence =
                    monotone?.SyllablePitchDeltaConfidence;
                if (typeof monotoneConfidence === 'number')
                    errors.push({
                        type: 'monotone',
                        confidence: Math.round((1 - monotoneConfidence) * 100),
                    });
                break;
            }
            default:
                break;
        }
        return errors;
    }

    private transformSegmentToWords(segmentData: unknown) {
        const segment = segmentData as Record<string, unknown>;
        if (
            !segment?.NBest ||
            !Array.isArray(segment.NBest) ||
            !segment.NBest[0]
        )
            return [];
        const firstResult = segment.NBest[0] as Record<string, unknown>;
        if (!firstResult.Words || !Array.isArray(firstResult.Words)) return [];

        const TICKS_PER_MILLISECOND = 10000;
        const words = firstResult.Words;
        const segmentConfidence =
            ((firstResult.Confidence as number) || 0) * 100;
        const normalize = (w: unknown) =>
            typeof w === 'string' ? w.toLowerCase() : '';
        return words.map((wordData: unknown, idx: number) => {
            const word = wordData as Record<string, unknown>;
            const prevWord =
                idx > 0
                    ? (words[idx - 1] as Record<string, unknown>)?.Word
                    : undefined;
            const isDuplicated =
                idx > 0 && normalize(word?.Word) === normalize(prevWord);
            const phonemes = Array.isArray(word.Phonemes)
                ? word.Phonemes.map((phonemeData: unknown) => {
                      const phoneme = phonemeData as Record<string, unknown>;
                      const pronAssessment =
                          phoneme.PronunciationAssessment as Record<
                              string,
                              unknown
                          >;
                      const accuracyScore =
                          (pronAssessment?.AccuracyScore as number) || 0;
                      const isCorrect = accuracyScore > 60;
                      const nbestPhonemes =
                          pronAssessment?.NBestPhonemes as Array<
                              Record<string, unknown>
                          >;
                      const actualPhoneme = isCorrect
                          ? phoneme?.Phoneme
                          : nbestPhonemes?.[0]?.Phoneme || '';
                      return {
                          phoneme: phoneme?.Phoneme,
                          accuracy: accuracyScore,
                          offset:
                              ((phoneme?.Offset as number) || 0) /
                              TICKS_PER_MILLISECOND,
                          duration:
                              ((phoneme?.Duration as number) || 0) /
                              TICKS_PER_MILLISECOND,
                          expectedPhoneme: phoneme?.Phoneme,
                          actualPhoneme,
                          isCorrect,
                      };
                  })
                : [];
            const syllables = Array.isArray(word.Syllables)
                ? word.Syllables.map((syllableData: unknown) => {
                      const syllable = syllableData as Record<string, unknown>;
                      const pronAssessment =
                          syllable.PronunciationAssessment as Record<
                              string,
                              unknown
                          >;
                      return {
                          syllable: syllable?.Syllable,
                          grapheme: syllable?.Grapheme,
                          accuracyScore: pronAssessment?.AccuracyScore,
                          offset:
                              ((syllable?.Offset as number) || 0) /
                              TICKS_PER_MILLISECOND,
                          duration:
                              ((syllable?.Duration as number) || 0) /
                              TICKS_PER_MILLISECOND,
                      };
                  })
                : [];
            const expectedPronunciation = `/${syllables.map((syllable: Record<string, unknown>) => syllable.syllable).join('')}/`;
            const actualPronunciation = `/${phonemes
                .filter((phoneme: Record<string, unknown>) => phoneme.isCorrect)
                .map(
                    (phoneme: Record<string, unknown>) => phoneme.actualPhoneme
                )
                .join('')}/`;
            const errors = this.extractErrors(word.PronunciationAssessment);
            return {
                word: word.Word,
                accuracy: (
                    word?.PronunciationAssessment as Record<string, unknown>
                )?.AccuracyScore,
                offset: ((word?.Offset as number) || 0) / TICKS_PER_MILLISECOND,
                duration:
                    ((word?.Duration as number) || 0) / TICKS_PER_MILLISECOND,
                phonemes,
                syllables,
                errors,
                isStressed: false,
                isDuplicated,
                confidenceScore: segmentConfidence,
                expectedPronunciation,
                actualPronunciation,
            };
        });
    }

    createTranscriptData(
        azureResponseArray: unknown[],
        audioUrl: string = ''
    ): Record<string, unknown> {
        const segments = azureResponseArray
            .map((segmentData, index) => {
                const segment = segmentData as Record<string, unknown>;
                const words = this.transformSegmentToWords(segmentData);
                if (!words.length) return null;
                const lastWord = words[words.length - 1];
                const NBest = segment?.NBest as Array<Record<string, unknown>>;
                const overallPronunciationScore = NBest?.[0]
                    ?.PronunciationAssessment
                    ? ((
                          NBest[0].PronunciationAssessment as Record<
                              string,
                              unknown
                          >
                      ).PronScore as number) || 0
                    : 0;
                return {
                    id: `segment-${index + 1}`,
                    startTime: words[0].offset,
                    endTime: lastWord.offset + lastWord.duration,
                    text: (segment?.DisplayText as string) || '',
                    words,
                    overallAccuracy: overallPronunciationScore,
                };
            })
            .filter(Boolean);

        const lastSegment = segments[segments.length - 1] as Record<
            string,
            unknown
        >;
        const totalDuration = segments.length
            ? (lastSegment.endTime as number)
            : 0;
        const speakingTime = segments.reduce((segSum: number, seg) => {
            if (!seg) return segSum;
            const words = seg.words as Array<Record<string, unknown>>;
            const wDur = words.reduce(
                (wSum: number, w: Record<string, unknown>) =>
                    wSum + ((w.duration as number) || 0),
                0
            );
            return segSum + wDur;
        }, 0);

        return {
            audioUrl,
            segments,
            metadata: {
                duration: totalDuration / 1000,
                speakingTime: speakingTime / 1000,
                language: 'en-US',
                assessmentType: 'pronunciation',
                createdAt: new Date().toISOString(),
            },
            overall: {
                AccuracyScore: (() => {
                    const firstResponse = azureResponseArray?.[0] as Record<
                        string,
                        unknown
                    >;
                    const NBest = firstResponse?.NBest as Array<
                        Record<string, unknown>
                    >;
                    return NBest?.[0]?.PronunciationAssessment
                        ? ((
                              NBest[0].PronunciationAssessment as Record<
                                  string,
                                  unknown
                              >
                          ).AccuracyScore as number) || 0
                        : 0;
                })(),
                FluencyScore: (() => {
                    const firstResponse = azureResponseArray?.[0] as Record<
                        string,
                        unknown
                    >;
                    const NBest = firstResponse?.NBest as Array<
                        Record<string, unknown>
                    >;
                    return NBest?.[0]?.PronunciationAssessment
                        ? ((
                              NBest[0].PronunciationAssessment as Record<
                                  string,
                                  unknown
                              >
                          ).FluencyScore as number) || 0
                        : 0;
                })(),
                ProsodyScore: (() => {
                    const firstResponse = azureResponseArray?.[0] as Record<
                        string,
                        unknown
                    >;
                    const NBest = firstResponse?.NBest as Array<
                        Record<string, unknown>
                    >;
                    return NBest?.[0]?.PronunciationAssessment
                        ? ((
                              NBest[0].PronunciationAssessment as Record<
                                  string,
                                  unknown
                              >
                          ).ProsodyScore as number) || 0
                        : 0;
                })(),
                CompletenessScore: (() => {
                    const firstResponse = azureResponseArray?.[0] as Record<
                        string,
                        unknown
                    >;
                    const NBest = firstResponse?.NBest as Array<
                        Record<string, unknown>
                    >;
                    return NBest?.[0]?.PronunciationAssessment
                        ? ((
                              NBest[0].PronunciationAssessment as Record<
                                  string,
                                  unknown
                              >
                          ).CompletenessScore as number) || 0
                        : 0;
                })(),
                PronScore: (() => {
                    const firstResponse = azureResponseArray?.[0] as Record<
                        string,
                        unknown
                    >;
                    const NBest = firstResponse?.NBest as Array<
                        Record<string, unknown>
                    >;
                    return NBest?.[0]?.PronunciationAssessment
                        ? ((
                              NBest[0].PronunciationAssessment as Record<
                                  string,
                                  unknown
                              >
                          ).PronScore as number) || 0
                        : 0;
                })(),
            },
        };
    }
}

export default new SpeechTransformService();
