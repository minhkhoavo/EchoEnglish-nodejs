import { recsysConfig } from '../config.js';

const MIN_INTERVAL_MS = 30 * 60_000;
const lastSent = new Map<string, number>();

/**
 * Operational alert. Always logged; additionally POSTed to RECSYS_ALERT_WEBHOOK_URL
 * (Slack-compatible `{ text }`) when configured. The same `key` is sent at most once per
 * 30 minutes so a job failing every tick does not flood the channel. Never throws.
 */
export async function sendAlert(
    key: string,
    text: string,
    now = Date.now(),
    post: typeof fetch = fetch
): Promise<boolean> {
    console.warn(`[recsys][alert] ${key}: ${text}`);
    const url = recsysConfig.alertWebhookUrl();
    if (!url) return false;
    const last = lastSent.get(key);
    if (last !== undefined && now - last < MIN_INTERVAL_MS) return false;
    lastSent.set(key, now);
    try {
        const res = await post(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: `[recsys] ${key}: ${text}` }),
            signal: AbortSignal.timeout(5000),
        });
        return res.ok;
    } catch (e) {
        console.error('[recsys] alert delivery failed:', (e as Error).message);
        return false;
    }
}

export const resetAlertsForTests = () => lastSent.clear();
