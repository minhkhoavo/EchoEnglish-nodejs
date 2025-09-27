export interface UsageMetadata {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
}

export interface AIUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    totalCost: number;
    currency: string;
    model: string;
}

export interface GeminiUsageResponse {
    modelVersion?: string;
    usage_metadata?: UsageMetadata;
}

const RATE_TABLE: Record<
    string,
    { promptRate: number; completionRate: number; currency: string }
> = {
    'gemini-2.0-flash': {
        promptRate: 0.1,
        completionRate: 0.4,
        currency: 'USD',
    },
    'gemini-2.0-pro': { promptRate: 0.3, completionRate: 0.6, currency: 'USD' },
};

export function extractTextFromMessage(response: unknown): string {
    if (!response) return '';
    const message = response as {
        content?: unknown;
        text?: string;
    };

    if (typeof message.text === 'string') {
        return message.text;
    }

    if (Array.isArray(message.content)) {
        const parts = message.content
            .map((part: unknown) => {
                if (!part) return '';
                if (typeof part === 'string') return part;
                const maybeText = (part as { text?: string }).text;
                return maybeText ?? '';
            })
            .filter(Boolean);
        return parts.join('\n');
    }

    if (typeof message.content === 'string') {
        return message.content;
    }

    return String(response);
}

export function extractUsageMetadata(response: unknown):
    | {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
          model: string;
      }
    | undefined {
    const resp = response as GeminiUsageResponse;
    const usage = resp.usage_metadata;
    if (!usage) return undefined;

    // Try different possible field names from Gemini API
    const promptTokens = usage.input_tokens ?? 0;
    const completionTokens = usage.output_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? 0;
    const model = resp.modelVersion ?? 'gemini-2.0-flash'; // fallback model

    return {
        promptTokens,
        completionTokens,
        totalTokens,
        model,
    };
}

export function composeUsage(
    response: GeminiUsageResponse
): AIUsage | undefined {
    const usage = extractUsageMetadata(response);
    if (!usage) return undefined;

    const rates =
        RATE_TABLE[usage.model] ??
        ({ promptRate: 0, completionRate: 0, currency: 'USD' } as const);

    const totalCost =
        (usage.promptTokens / 1000000) * rates.promptRate +
        (usage.completionTokens / 1000000) * rates.completionRate;

    return {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        totalCost: Number(totalCost.toFixed(6)),
        currency: rates.currency,
        model: usage.model,
    };
}
