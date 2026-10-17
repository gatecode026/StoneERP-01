import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDsn, reportError, resetErrorReport } from '@/lib/errorReport';

const ok = () => vi.fn(async () => new Response('ok'));
beforeEach(() => { resetErrorReport(); });
afterEach(() => { delete process.env.ERROR_WEBHOOK_URL; delete process.env.SENTRY_DSN; });

describe('error alerts', () => {
  it('sends nothing anywhere unless a webhook is configured', async () => {
    const send = ok();
    expect(await reportError(new Error('boom'), {}, 1_000, send as never)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('posts a short message with where it happened, then at most one per minute, and says how many it held back', async () => {
    process.env.ERROR_WEBHOOK_URL = 'https://hooks.example.com/x';
    const send = ok();
    expect(await reportError(new Error('first'), { method: 'GET', path: '/api/sales' }, 100_000, send as never)).toBe(true);
    const body = JSON.parse((send.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.text).toContain('first');
    expect(body.text).toContain('GET /api/sales');
    expect(await reportError(new Error('second'), {}, 110_000, send as never)).toBe(false);
    expect(await reportError(new Error('third'), {}, 120_000, send as never)).toBe(false);
    expect(await reportError(new Error('fourth'), {}, 161_000, send as never)).toBe(true);
    expect(JSON.parse((send.mock.calls[1] as unknown as [string, { body: string }])[1].body).text).toContain('+2 more');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('an alert that cannot be delivered never throws', async () => {
    process.env.ERROR_WEBHOOK_URL = 'https://hooks.example.com/x';
    const send = vi.fn(async () => { throw new Error('network down'); });
    await expect(reportError(new Error('boom'), {}, 1_000_000, send as never)).resolves.toBe(false);
  });

  it('sends an error to Sentry (envelope over HTTP) when SENTRY_DSN is set, and no more than 20 a minute', async () => {
    process.env.SENTRY_DSN = 'https://abc123@o1.ingest.example.io/4500';
    expect(parseDsn(process.env.SENTRY_DSN)).toMatchObject({ key: 'abc123', url: 'https://o1.ingest.example.io/api/4500/envelope/?sentry_key=abc123&sentry_version=7' });
    expect(parseDsn('not a dsn')).toBeNull();
    const send = ok();
    expect(await reportError(new Error('boom'), { method: 'POST', path: '/api/sales' }, 5_000_000, send as never)).toBe(true);
    const [url, init] = send.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toContain('/api/4500/envelope/');
    const lines = init.body.split('\n').map((l) => JSON.parse(l));
    expect(lines[1]).toEqual({ type: 'event' });
    expect(lines[2].exception.values[0].value).toBe('boom');
    expect(lines[2].request).toMatchObject({ method: 'POST', url: '/api/sales' });
    for (let i = 0; i < 25; i++) await reportError(new Error('x'), {}, 5_000_100, send as never);
    expect(send).toHaveBeenCalledTimes(20);
  });
});
