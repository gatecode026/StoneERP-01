import { logger } from './logger';

/**
 * Unhandled server errors (a page or API route that crashed) are written to the log with where they happened and, when
 * ERROR_WEBHOOK_URL is set, posted there as a short text message (Slack, Discord, Teams or any URL that accepts {"text": "..."}).
 * At most one message per minute, so a crash loop cannot flood the channel; the log still has every error.
 * With SENTRY_DSN set, each error is also sent to Sentry (or any Sentry-compatible server such as GlitchTip) through its plain HTTP
 * "envelope" endpoint, at most 20 a minute. No tracker SDK is bundled: the app stays small and sends nothing anywhere unless you opt in.
 */
const WINDOW_MS = 60_000;
let lastSent = 0;
let suppressed = 0;
let sentryWindowStart = 0;
let sentryCount = 0;
const SENTRY_PER_MINUTE = 20;

export type ErrorContext = { path?: string; method?: string; routeType?: string; routePath?: string };

/** DSN https://<key>@<host>/<projectId>  ->  where and how to post an envelope. */
export function parseDsn(dsn: string) {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, '').split('/').pop();
    if (!u.username || !projectId) return null;
    return { key: u.username, url: `${u.protocol}//${u.host}/api/${projectId}/envelope/?sentry_key=${u.username}&sentry_version=7` };
  } catch {
    return null;
  }
}

async function sendToSentry(err: unknown, ctx: ErrorContext, now: number, send: typeof fetch) {
  const dsn = process.env.SENTRY_DSN && parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return false;
  if (now - sentryWindowStart >= WINDOW_MS) { sentryWindowStart = now; sentryCount = 0; }
  if (++sentryCount > SENTRY_PER_MINUTE) return false;
  const e = err as { message?: string; digest?: string; stack?: string; name?: string };
  const eventId = crypto.randomUUID().replace(/-/g, '');
  const event = {
    event_id: eventId,
    timestamp: now / 1000,
    platform: 'node',
    level: 'error',
    environment: process.env.NODE_ENV,
    exception: { values: [{ type: e?.name ?? 'Error', value: String(e?.message ?? err).slice(0, 1000), ...(e?.stack ? { stacktrace: { frames: e.stack.split('\n').slice(1, 30).map((line) => ({ function: line.trim() })).reverse() } } : {}) }] },
    request: { url: ctx.path, method: ctx.method },
    tags: { route: ctx.routePath ?? '', routeType: ctx.routeType ?? '', ref: e?.digest ?? '' },
  };
  const body = [{ event_id: eventId, sent_at: new Date(now).toISOString() }, { type: 'event' }, event].map((x) => JSON.stringify(x)).join('\n');
  try {
    await send(dsn.url, { method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope' }, body, signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

export async function reportError(err: unknown, ctx: ErrorContext = {}, now = Date.now(), send: typeof fetch = fetch) {
  const e = err as { message?: string; digest?: string; stack?: string };
  logger.error({ err, digest: e?.digest, ...ctx }, 'unhandled server error');
  const sentry = await sendToSentry(err, ctx, now, send);
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return sentry;
  if (now - lastSent < WINDOW_MS) { suppressed++; return sentry; }
  const more = suppressed ? ` (+${suppressed} more in the last minute)` : '';
  lastSent = now; suppressed = 0;
  const text = `Vipul Stone ERP error: ${String(e?.message ?? err).slice(0, 300)}\n${ctx.method ?? ''} ${ctx.path ?? ''}${e?.digest ? ` · ref ${e.digest}` : ''}${more}`.trim();
  try {
    await send(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return sentry; // an alert that cannot be delivered must never become a second error
  }
}

/** test helper */
export function resetErrorReport() { lastSent = 0; suppressed = 0; sentryWindowStart = 0; sentryCount = 0; }
