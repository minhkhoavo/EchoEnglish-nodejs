import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { Types } from 'mongoose';
import { imageUrlToDataUrl } from '~/utils/imageUtils';

import RecordingService from '~/services/recordingService';
import { promptManagerService } from './PromptManagerService';
import { googleGenAIClient } from '../provider/googleGenAIClient';

export interface IQuestionContext {
  questionType:
    | 'speaking_part1'
    | 'speaking_part2'
    | 'speaking_part3'
    | 'speaking_part4'
    | 'speaking_part5'
    | 'speaking_part6';
  referenceText?: string;
  questionPrompt?: string;
  providedInfo?: string;
  imageUrl?: string;
}

class AIScoringService {
  private getTemplateNameForType(
    type: IQuestionContext['questionType']
  ): string {
    const mapping: Record<string, string> = {
      speaking_part1: 'part_1_read_aloud',
      speaking_part2: 'part_2_describe_picture',
      speaking_part3: 'part_3_respond_short',
      speaking_part4: 'part_4_respond_with_info',
      speaking_part5: 'part_5_express_opinion',
      speaking_part6: 'part_6_propose_solution',
    };
    const templateName = mapping[type];
    if (!templateName) {
      throw new Error(`Invalid questionType: ${type}`);
    }

    return templateName;
  }

  public async scoreRecording(
    recordingId: string | Types.ObjectId,
    context: IQuestionContext
  ): Promise<any> {
    const summary: any =
      await RecordingService.getRecordingSummary(recordingId);
    if (!summary) {
      throw new Error('Could not get recording summary.');
    }

    const templateName = this.getTemplateNameForType(context.questionType);
    const templateString = await promptManagerService.getTemplate(templateName);

    const inputData = {
      ...context,
      transcript: summary.transcript,
      pronunciationScore: summary.quantitativeMetrics.pronunciationScore,
      fluencyScore: summary.quantitativeMetrics.fluencyScore,
      prosodyScore: summary.quantitativeMetrics.prosodyScore,
      wordsPerMinute: summary.quantitativeMetrics.wordsPerMinute,
      pronunciationMistakes:
        summary.qualitativeAnalysis.pronunciationMistakes
          .map((e: string) => `- ${e}`)
          .join('\n') || 'None',
      // fluencyIssues: summary.qualitativeAnalysis.fluencyIssues.map((e: string) => `- ${e}`).join('\n') || 'None',
      fluencyIssues: 'None',
    };

    const formattedText =
      await PromptTemplate.fromTemplate(templateString).format(inputData);
    const model = googleGenAIClient.getModel();
    const parser = new JsonOutputParser();
    let message: string | Array<{ role: string; content: any }>;

    if (context.imageUrl) {
      const dataUrl = await imageUrlToDataUrl(context.imageUrl);
      message = [
        {
          role: 'user',
          content: [
            { type: 'text', text: formattedText },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ];
    } else {
      message = formattedText;
    }
    try {
      const chain = model.pipe(parser);
      return await chain.invoke(message);
    } catch (error) {
      console.error('[AIScoringService] Chain invocation failed.', error);
      throw new Error(
        'AI model failed to process the request or return valid JSON.'
      );
    }
  }
}

export const aiScoringService = new AIScoringService();
