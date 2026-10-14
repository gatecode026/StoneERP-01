import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { call } from '../api';
import * as health from '@/app/api/health/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
beforeAll(async () => { db = await useTestDb('health'); });
afterAll(async () => { await db.close(); });

describe('health check', () => {
  it('answers without signing in, says nothing secret, and is never cached', async () => {
    const r = await call(null, health.GET as never, '/api/health');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: 'ok' });
    expect(Object.keys(r.json).sort()).toEqual(['status', 'time', 'version']);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('the deep check also pings the database', async () => {
    const r = await call(null, health.GET as never, '/api/health?deep=1');
    expect(r.status).toBe(200);
    expect(r.json.db).toMatchObject({ ok: true });
    expect(r.json.db.ms).toBeGreaterThanOrEqual(0);
  });
});
