import { AsyncLocalStorage } from 'node:async_hooks';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import { eventService } from './eventService.js';
import { recsysConfig } from '../config.js';

/**
 * Per-learner AI cost tracking.
 *  - The auth middleware binds the current user into AsyncLocalStorage.
 *  - A LangChain callback attached to every Gemini model reports token usage on completion.
 *  - Each completion becomes an `ai_usage` event → daily facts → "AI cost per learner" KPI.
 * Calls made outside a request (cron, RSS labelling) have no user and are skipped: they are
 * platform cost, not learner cost.
 */
interface AiContext {
    userId?: string;
    feature?: string;
}
export const aiContext = new AsyncLocalStorage<AiContext>();

export function bindUser(userId: string | undefined): void {
    if (userId) aiContext.enterWith({ userId });
}

/** Tag everything inside `fn` with a feature name (e.g. 'daily_plan') for cost attribution. */
export function runWithFeature<T>(feature: string, fn: () => T): T {
    return aiContext.run({ ...(aiContext.getStore() ?? {}), feature }, fn);
}

type Rates = Record<string, { in: number; out: number }>; // USD per 1M tokens

/**
 * Prices change and differ per model/tier, so they are configuration, not code:
 * RECSYS_AI_RATES_JSON='{"gemini-2.5-flash-lite":{"in":0.10,"out":0.40}}'
 * Unknown model → cost 0 (tokens are still recorded; cost can be recomputed later).
 */
export function loadRates(raw = process.env.RECSYS_AI_RATES_JSON): Rates {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as Rates;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function computeCostUsd(
    model: string,
    promptTokens: number,
    completionTokens: number,
    rates: Rates = loadRates()
): number {
    const r = rates[model];
    if (!r) return 0;
    return Number(
        ((promptTokens * r.in + completionTokens * r.out) / 1_000_000).toFixed(
            6
        )
    );
}

/** Pull token counts out of a LangChain LLMResult across provider shapes. */
export function extractUsage(
    output: LLMResult
): { promptTokens: number; completionTokens: number } | undefined {
    const gen = output.generations?.[0]?.[0] as
        | {
              message?: {
                  usage_metadata?: {
                      input_tokens?: number;
                      output_tokens?: number;
                  };
              };
          }
        | undefined;
    const um = gen?.message?.usage_metadata;
    if (
        um &&
        (um.input_tokens !== undefined || um.output_tokens !== undefined)
    ) {
        return {
            promptTokens: um.input_tokens ?? 0,
            completionTokens: um.output_tokens ?? 0,
        };
    }
    const tu = (
        output.llmOutput as
            | {
                  tokenUsage?: {
                      promptTokens?: number;
                      completionTokens?: number;
                  };
              }
            | undefined
    )?.tokenUsage;
    if (tu)
        return {
            promptTokens: tu.promptTokens ?? 0,
            completionTokens: tu.completionTokens ?? 0,
        };
    return undefined;
}

export class AiUsageCallback extends BaseCallbackHandler {
    name = 'recsys_ai_usage';

    constructor(private readonly modelName: string) {
        super();
    }

    handleLLMEnd(output: LLMResult): void {
        try {
            if (!recsysConfig.enabled()) return;
            const store = aiContext.getStore();
            const usage = extractUsage(output);
            if (!store?.userId || !usage) return;
            eventService.emit(store.userId, 'ai_usage', {
                feature: store.feature ?? 'unspecified',
                model: this.modelName,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                costUsd: computeCostUsd(
                    this.modelName,
                    usage.promptTokens,
                    usage.completionTokens
                ),
            });
        } catch {
            /* tracking must never break an AI call */
        }
    }
}

/** Attach usage tracking to a LangChain chat model instance (idempotent, never throws). */
export function attachAiUsage<T extends object>(
    model: T,
    modelName: string
): T {
    try {
        const m = model as { callbacks?: unknown };
        const existing = Array.isArray(m.callbacks) ? m.callbacks : [];
        if (
            !existing.some(
                (c) => (c as { name?: string })?.name === 'recsys_ai_usage'
            )
        ) {
            m.callbacks = [...existing, new AiUsageCallback(modelName)];
        }
    } catch {
        /* ignore */
    }
    return model;
}
