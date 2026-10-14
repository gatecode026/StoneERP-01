/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import mongoose from 'mongoose';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { AuditLog } from '@/lib/models';
import { backupKey, backupStream, restoreBackup, runBackup } from '@/lib/backup';
import { runJob } from '@/lib/jobs';
import { setStorageForTests, type StorageDriver } from '@/lib/storage';
import * as download from '@/app/api/backup/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, manager: Who;

// a throw-away storage that keeps objects in memory
const objects = new Map<string, Buffer>();
const mem: StorageDriver = {
  name: 'memory',
  async put(k, b) { objects.set(k, b); },
  async get(k) { const b = objects.get(k); return b ? { body: b, contentType: 'application/gzip' } : null; },
  async exists(k) { return objects.has(k); },
  async remove(k) { objects.delete(k); },
  async signedUrl() { return null; },
  async health() { return true; },
};

beforeAll(async () => {
  db = await useTestDb('backup'); resetCaches(); setStorageForTests(mem);
  owner = await makeUser('owner'); manager = await makeUser('manager');
});
afterAll(async () => { setStorageForTests(null); await db.close(); });

const toBuffer = async (s: Readable) => { const c: Buffer[] = []; for await (const x of s) c.push(x as Buffer); return Buffer.concat(c); };
const counts = async () => {
  const d = mongoose.connection.db!;
  const out: Record<string, number> = {};
  for (const c of await d.listCollections({}, { nameOnly: true }).toArray()) if (!/^(system\.|sessions$|ratelimits?$|otps?$)/.test(c.name)) out[c.name] = await d.collection(c.name).countDocuments();
  return out;
};

describe('backup and restore', () => {
  it('a backup restores to exactly the same data (ids, dates, encrypted fields, password hashes)', async () => {
    for (const n of ['Ramesh Meena', 'Suresh Jat']) {
      expect((await api.create(owner, 'employees', { name: n, job: 'Helper', mobile: n === 'Ramesh Meena' ? '9829011111' : '9829022222', payType: 'daily', rate: 500, bankAccount: '123456789012' })).status).toBe(201);
    }
    const d = mongoose.connection.db!;
    const before = await counts();
    const emp: any = await d.collection('employees').findOne({ name: 'Ramesh Meena' });
    const user: any = await d.collection('users').findOne({ _id: new mongoose.Types.ObjectId(owner.id) });
    expect(emp.bankAccount).toBeTruthy();

    const file = await toBuffer(backupStream({ includeSecrets: true }));
    const head = JSON.parse(gunzipSync(file).toString().split('\n')[0]);
    expect(head).toMatchObject({ format: 'vss-backup-1', passwordHashes: true });
    expect(head.collections).not.toContain('sessions');

    for (const name of Object.keys(before)) await d.collection(name).deleteMany({});
    expect(Object.values(await counts()).every((n) => n === 0)).toBe(true);

    const restored = await restoreBackup(Readable.from([file]));
    expect(Object.values(restored).reduce((a, b) => a + b, 0)).toBe(Object.values(before).reduce((a, b) => a + b, 0));
    expect(await counts()).toEqual(before);
    expect(await d.collection('employees').findOne({ name: 'Ramesh Meena' })).toEqual(emp); // _id, Date and encrypted value all identical
    expect(((await d.collection('users').findOne({ _id: user._id })) as any).passwordHash).toBe(user.passwordHash);
  });

  it('a restore refuses to mix into a database that already has data, unless replacing is asked for', async () => {
    const file = await toBuffer(backupStream({ includeSecrets: true }));
    await expect(restoreBackup(Readable.from([file]))).rejects.toThrow(/already has data/);
    await expect(restoreBackup(Readable.from([Buffer.from('not a backup')]))).rejects.toThrow();
    const n = await counts();
    await restoreBackup(Readable.from([file]), { replace: true });
    expect(await counts()).toEqual(n);
  });

  it('the file the Owner downloads has no password hashes; only the Owner can get it; it is audit-logged', async () => {
    expect((await call(manager, download.GET as never, '/api/backup')).status).toBe(403);
    expect((await call(null, download.GET as never, '/api/backup')).status).toBe(401);
    const res = await (download.GET as any)(new (await import('next/server')).NextRequest('http://localhost/api/backup', { headers: { cookie: owner.cookie, host: 'localhost', origin: 'http://localhost' } }), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/vipul-stone-backup-\d{4}-\d{2}-\d{2}\.ndjson\.gz/);
    const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString();
    expect(text).not.toContain('"passwordHash"'); // the header's "passwordHashes":false is a flag, not data
    expect(text).toContain('Ramesh Meena');
    expect(await AuditLog.countDocuments({ model: 'backup', action: 'export' })).toBe(1);
  });

  it('the nightly job stores one file per day and removes the one that fell out of the retention window', async () => {
    objects.set(backupKey('2026-09-01'), Buffer.from('old'));
    const r = await runBackup('2026-09-15'); // 14 days of retention → 2026-09-01 goes
    expect(r.key).toBe('backups/2026-09-15.ndjson.gz');
    expect(objects.has(backupKey('2026-09-15'))).toBe(true);
    expect(objects.has(backupKey('2026-09-01'))).toBe(false);
    const run = await runJob('backup', { period: '2026-09-16' });
    expect(run).toMatchObject({ status: 'ok', skipped: false });
    expect((await runJob('backup', { period: '2026-09-16' })).skipped).toBe(true); // once per day
  });
});
