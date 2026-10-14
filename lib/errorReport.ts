import { logger } from './logger';

/**
 * Unhandled server errors (a page or API route that crashed) are written to the log with where they happened and, when
 * ERROR_WEBHOOK_URL is set, posted there as a short text message (Slack, Discord, Teams or any URL that accepts {"text": "..."}).
 * At most one message per minute, so a crash loop cannot flood the channel; the log still has every error.
 * No error tracker (Sentry) SDK is bundled: this keeps the app small and sends nothing anywhere unless you opt in.
 */
const WINDOW_MS = 60_000;
let lastSent = 0;
let suppressed = 0;

export type ErrorContext = { path?: string; method?: string; routeType?: string; routePath?: string };

export async function reportError(err: unknown, ctx: ErrorContext = {}, now = Date.now(), send: typeof fetch = fetch) {
  const e = err as { message?: string; digest?: string; stack?: string };
  logger.error({ err, digest: e?.digest, ...ctx }, 'unhandled server error');
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return false;
  if (now - lastSent < WINDOW_MS) { suppressed++; return false; }
  const more = suppressed ? ` (+${suppressed} more in the last minute)` : '';
  lastSent = now; suppressed = 0;
  const text = `Vipul Stone ERP error: ${String(e?.message ?? err).slice(0, 300)}\n${ctx.method ?? ''} ${ctx.path ?? ''}${e?.digest ? ` · ref ${e.digest}` : ''}${more}`.trim();
  try {
    await send(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false; // an alert that cannot be delivered must never become a second error
  }
}

/** test helper */
export function resetErrorReport() { lastSent = 0; suppressed = 0; }
