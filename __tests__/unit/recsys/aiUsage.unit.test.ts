import {
    aiContext,
    AiUsageCallback,
    attachAiUsage,
    bindUser,
    computeCostUsd,
    extractUsage,
    loadRates,
    runWithFeature,
} from '~/recsys/events/aiUsageTracker.js';
import { eventService } from '~/recsys/events/eventService.js';
import { summariseAzureScores } from '~/recsys/events/emitters.js';
import type { LLMResult } from '@langchain/core/outputs';

const result = (usage?: object, tokenUsage?: object): LLMResult =>
    ({
        generations: [
            [{ text: 'x', message: usage ? { usage_metadata: usage } : {} }],
        ],
        llmOutput: tokenUsage ? { tokenUsage } : undefined,
    }) as unknown as LLMResult;

describe('AI usage tracking', () => {
    const prev = {
        en: process.env.RECSYS_ENABLED,
        rates: process.env.RECSYS_AI_RATES_JSON,
    };
    afterEach(() => {
        process.env.RECSYS_ENABLED = prev.en;
        process.env.RECSYS_AI_RATES_JSON = prev.rates;
        jest.restoreAllMocks();
    });

    it('extracts token usage from usage_metadata or tokenUsage, else undefined', () => {
        expect(
            extractUsage(result({ input_tokens: 10, output_tokens: 5 }))
        ).toEqual({ promptTokens: 10, completionTokens: 5 });
        expect(
            extractUsage(
                result(undefined, { promptTokens: 7, completionTokens: 3 })
            )
        ).toEqual({ promptTokens: 7, completionTokens: 3 });
        expect(extractUsage(result())).toBeUndefined();
    });

    it('cost comes from configurable rates; unknown model costs 0 (tokens still recorded)', () => {
        const rates = { m1: { in: 0.1, out: 0.4 } };
        expect(computeCostUsd('m1', 1_000_000, 500_000, rates)).toBe(0.3);
        expect(computeCostUsd('other', 1_000_000, 1_000_000, rates)).toBe(0);
        process.env.RECSYS_AI_RATES_JSON = '{bad json';
        expect(loadRates()).toEqual({});
        process.env.RECSYS_AI_RATES_JSON = JSON.stringify(rates);
        expect(loadRates()).toEqual(rates);
    });

    it('emits ai_usage attributed to the bound user and feature', async () => {
        process.env.RECSYS_ENABLED = 'true';
        process.env.RECSYS_AI_RATES_JSON = JSON.stringify({
            gm: { in: 1, out: 2 },
        });
        const spy = jest
            .spyOn(eventService, 'emit')
            .mockImplementation(() => undefined);
        const cb = new AiUsageCallback('gm');
        await aiContext.run({ userId: 'user-1' }, async () => {
            runWithFeature('daily_plan', () =>
                cb.handleLLMEnd(
                    result({ input_tokens: 1000, output_tokens: 500 })
                )
            );
        });
        expect(spy).toHaveBeenCalledWith('user-1', 'ai_usage', {
            feature: 'daily_plan',
            model: 'gm',
            promptTokens: 1000,
            completionTokens: 500,
            costUsd: 0.002,
        });
    });

    it('does nothing without a user (cron/system calls), when disabled, or on malformed output — and never throws', () => {
        process.env.RECSYS_ENABLED = 'true';
        const spy = jest
            .spyOn(eventService, 'emit')
            .mockImplementation(() => undefined);
        const cb = new AiUsageCallback('gm');
        cb.handleLLMEnd(result({ input_tokens: 1, output_tokens: 1 })); // no ALS store
        expect(spy).not.toHaveBeenCalled();
        process.env.RECSYS_ENABLED = 'false';
        aiContext.run({ userId: 'u' }, () =>
            cb.handleLLMEnd(result({ input_tokens: 1, output_tokens: 1 }))
        );
        expect(spy).not.toHaveBeenCalled();
        process.env.RECSYS_ENABLED = 'true';
        expect(() =>
            aiContext.run({ userId: 'u' }, () =>
                cb.handleLLMEnd(null as unknown as LLMResult)
            )
        ).not.toThrow();
    });

    it('attachAiUsage is idempotent and tolerant of odd models', () => {
        const model: { callbacks?: unknown[] } = {
            callbacks: [{ name: 'other' }],
        };
        attachAiUsage(model, 'm');
        attachAiUsage(model, 'm');
        expect(model.callbacks).toHaveLength(2);
        expect(() => attachAiUsage(Object.freeze({}), 'm')).not.toThrow();
    });

    it('bindUser ignores empty ids', () => {
        expect(() => bindUser(undefined)).not.toThrow();
    });
});

describe('summariseAzureScores', () => {
    it('averages scores across segments and clamps to 0..100', () => {
        const parsed = [
            {
                NBest: [
                    {
                        PronunciationAssessment: {
                            AccuracyScore: 80,
                            FluencyScore: 70,
                            CompletenessScore: 100,
                            ProsodyScore: 60,
                        },
                    },
                ],
            },
            {
                NBest: [
                    {
                        PronunciationAssessment: {
                            AccuracyScore: 100,
                            FluencyScore: 90,
                        },
                    },
                ],
            },
        ];
        expect(summariseAzureScores(parsed)).toEqual({
            accuracy: 90,
            fluency: 80,
            completeness: 100,
            prosody: 60,
        });
        expect(
            summariseAzureScores([
                {
                    NBest: [
                        { PronunciationAssessment: { AccuracyScore: 250 } },
                    ],
                },
            ]).accuracy
        ).toBe(100);
    });
    it('tolerates empty / malformed responses', () => {
        expect(summariseAzureScores([])).toEqual({
            accuracy: undefined,
            fluency: undefined,
            completeness: undefined,
            prosody: undefined,
        });
        expect(
            summariseAzureScores([null, {}, { NBest: [] }] as unknown[])
                .accuracy
        ).toBeUndefined();
    });
});
