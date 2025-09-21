class SpeechTransformService {
  private extractErrors(pronAssessment: any): Array<Record<string, any>> {
    const errors: Array<Record<string, any>> = [];
    const errorType = pronAssessment?.ErrorType;
    if (!errorType || errorType === 'None') return errors;
    switch (errorType) {
      case 'Mispronunciation':
        errors.push({
          type: 'mispronunciation',
          confidence: Math.round(100 - (pronAssessment?.AccuracyScore || 0)),
        });
        break;
      case 'UnexpectedBreak': {
        const unexpectedBreakConfidence =
          pronAssessment?.Feedback?.Prosody?.Break?.UnexpectedBreak?.Confidence;
        if (typeof unexpectedBreakConfidence === 'number')
          errors.push({
            type: 'unexpected_break',
            confidence: Math.round(unexpectedBreakConfidence * 100),
          });
        break;
      }
      case 'MissingBreak': {
        const missingBreakConfidence =
          pronAssessment?.Feedback?.Prosody?.Break?.MissingBreak?.Confidence;
        if (typeof missingBreakConfidence === 'number')
          errors.push({
            type: 'missing_break',
            confidence: Math.round(missingBreakConfidence * 100),
          });
        break;
      }
      case 'Monotone': {
        const monotoneConfidence =
          pronAssessment?.Feedback?.Prosody?.Intonation?.Monotone
            ?.SyllablePitchDeltaConfidence;
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

  private transformSegmentToWords(segmentData: any) {
    if (!segmentData?.NBest?.[0]?.Words) return [];
    const TICKS_PER_MILLISECOND = 10000;
    const words = segmentData.NBest[0].Words;
    const segmentConfidence = (segmentData.NBest[0].Confidence || 0) * 100;
    const normalize = (w: any) =>
      typeof w === 'string' ? w.toLowerCase() : '';
    return words.map((wordData: any, idx: number) => {
      const prevWord = idx > 0 ? words[idx - 1]?.Word : undefined;
      const isDuplicated =
        idx > 0 && normalize(wordData?.Word) === normalize(prevWord);
      const phonemes = (wordData.Phonemes || []).map((phonemeData: any) => {
        const isCorrect =
          (phonemeData?.PronunciationAssessment?.AccuracyScore || 0) > 60;
        const actualPhoneme = isCorrect
          ? phonemeData?.Phoneme
          : phonemeData?.PronunciationAssessment?.NBestPhonemes?.[0]?.Phoneme ||
            '';
        return {
          phoneme: phonemeData?.Phoneme,
          accuracy: phonemeData?.PronunciationAssessment?.AccuracyScore,
          offset: (phonemeData?.Offset || 0) / TICKS_PER_MILLISECOND,
          duration: (phonemeData?.Duration || 0) / TICKS_PER_MILLISECOND,
          expectedPhoneme: phonemeData?.Phoneme,
          actualPhoneme,
          isCorrect,
        };
      });
      const syllables = (wordData.Syllables || []).map((syllableData: any) => ({
        syllable: syllableData?.Syllable,
        grapheme: syllableData?.Grapheme,
        accuracyScore: syllableData?.PronunciationAssessment?.AccuracyScore,
        offset: (syllableData?.Offset || 0) / TICKS_PER_MILLISECOND,
        duration: (syllableData?.Duration || 0) / TICKS_PER_MILLISECOND,
      }));
      const expectedPronunciation = `/${syllables.map((syllable: any) => syllable.syllable).join('')}/`;
      const actualPronunciation = `/${phonemes
        .filter((phoneme: any) => phoneme.isCorrect)
        .map((phoneme: any) => phoneme.actualPhoneme)
        .join('')}/`;
      const errors = this.extractErrors(wordData.PronunciationAssessment);
      return {
        word: wordData.Word,
        accuracy: wordData?.PronunciationAssessment?.AccuracyScore,
        offset: (wordData?.Offset || 0) / TICKS_PER_MILLISECOND,
        duration: (wordData?.Duration || 0) / TICKS_PER_MILLISECOND,
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

  createTranscriptData(azureResponseArray: any[], audioUrl: string = ''): any {
    const segments = azureResponseArray
      .map((segmentData, index) => {
        const words = this.transformSegmentToWords(segmentData);
        if (!words.length) return null;
        const lastWord = words[words.length - 1];
        const overallPronunciationScore =
          segmentData?.NBest?.[0]?.PronunciationAssessment?.PronScore || 0;
        return {
          id: `segment-${index + 1}`,
          startTime: words[0].offset,
          endTime: lastWord.offset + lastWord.duration,
          text: segmentData?.DisplayText || '',
          words,
          overallAccuracy: overallPronunciationScore,
        };
      })
      .filter(Boolean);

    const totalDuration = segments.length
      ? (segments[segments.length - 1] as any).endTime
      : 0;
    const speakingTime = segments.reduce((segSum: number, seg: any) => {
      const wDur = (seg.words || []).reduce(
        (wSum: number, w: any) => wSum + (w.duration || 0),
        0
      );
      return segSum + wDur;
    }, 0);

    return {
      audioUrl,
      segments,
      metadata: {
        duration: totalDuration,
        speakingTime,
        language: 'en-US',
        assessmentType: 'pronunciation',
        createdAt: new Date().toISOString(),
      },
      overall: {
        AccuracyScore:
          azureResponseArray?.[0]?.NBest?.[0]?.PronunciationAssessment
            ?.AccuracyScore || 0,
        FluencyScore:
          azureResponseArray?.[0]?.NBest?.[0]?.PronunciationAssessment
            ?.FluencyScore || 0,
        ProsodyScore:
          azureResponseArray?.[0]?.NBest?.[0]?.PronunciationAssessment
            ?.ProsodyScore || 0,
        CompletenessScore:
          azureResponseArray?.[0]?.NBest?.[0]?.PronunciationAssessment
            ?.CompletenessScore || 0,
        PronScore:
          azureResponseArray?.[0]?.NBest?.[0]?.PronunciationAssessment
            ?.PronScore || 0,
      },
    };
  }
}

export default new SpeechTransformService();
