import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportError, resetErrorReport } from '@/lib/errorReport';

const ok = () => vi.fn(async () => new Response('ok'));
beforeEach(() => { resetErrorReport(); });
afterEach(() => { delete process.env.ERROR_WEBHOOK_URL; });

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
});
