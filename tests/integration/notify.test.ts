/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTestDb } from '../helpers';
import { call, makeUser, resetCaches, type Who } from '../api';
import { Notification } from '@/lib/models';
import { MAX_ATTEMPTS, sendQueued, waLink } from '@/lib/notify/whatsapp';
import { runJob } from '@/lib/jobs';
import * as list from '@/app/api/notifications/route';
import * as one from '@/app/api/notifications/[id]/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, manager: Who;
beforeAll(async () => { db = await useTestDb('notify'); resetCaches(); owner = await makeUser('owner'); manager = await makeUser('manager'); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await Notification.deleteMany({}); });
afterEach(() => { vi.unstubAllGlobals(); for (const k of ['WHATSAPP_PROVIDER', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_TEMPLATE']) delete process.env[k]; });

const queue = (id: string, to = '9829012345', text = 'Hello पूरा') => Notification.create({ _id: id, to, kind: 'test', text, status: 'queued' });
const cloud = () => Object.assign(process.env, { WHATSAPP_PROVIDER: 'cloud', WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '555' });
const reply = (status: number, json: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }));

describe('without a WhatsApp account the Owner sends by hand', () => {
  it('queued messages wait as "manual" with a one-tap link; the Owner marks them sent', async () => {
    await queue('m1'); await queue('m2', '9829099999', 'Second');
    expect(await sendQueued()).toMatchObject({ manual: 2, sent: 0 });
    expect((await Notification.findById('m1').lean() as any).status).toBe('manual');
    const r = await call(owner, list.GET as never, '/api/notifications');
    expect(r.json.automatic).toBe(false);
    expect(r.json.data).toHaveLength(2);
    expect(r.json.data.find((n: any) => n._id === 'm1').link).toBe(`https://wa.me/919829012345?text=${encodeURIComponent('Hello पूरा')}`);
    expect((await call(owner, one.PATCH as never, '/api/notifications/m1', { method: 'PATCH', body: { status: 'sent' }, params: { id: 'm1' } })).status).toBe(200);
    expect((await call(owner, one.PATCH as never, '/api/notifications/m1', { method: 'PATCH', body: { status: 'sent' }, params: { id: 'm1' } })).status).toBe(404); // already done
    expect((await call(owner, list.GET as never, '/api/notifications')).json.data.map((n: any) => n._id)).toEqual(['m2']);
  });

  it('only the Owner sees or changes them', async () => {
    expect((await call(manager, list.GET as never, '/api/notifications')).status).toBe(403);
    expect((await call(manager, one.PATCH as never, '/api/notifications/x', { method: 'PATCH', body: { status: 'sent' }, params: { id: 'x' } })).status).toBe(403);
  });

  it('wa.me links use the 10-digit number with the India code', () => {
    expect(waLink('+91 98290-12345', 'a b')).toBe('https://wa.me/919829012345?text=a%20b');
  });
});

describe('with the WhatsApp Cloud API', () => {
  it('sends, marks sent, and never sends the same message twice', async () => {
    cloud(); await queue('c1');
    const f = reply(200, { messages: [{ id: 'wamid' }] }); vi.stubGlobal('fetch', f);
    const [a, b] = await Promise.all([sendQueued(), sendQueued()]); // two overlapping runs
    expect(a.sent + b.sent).toBe(1);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://graph.facebook.com/v21.0/555/messages');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toMatchObject({ to: '919829012345', type: 'text', text: { body: 'Hello पूरा' } });
    expect((await Notification.findById('c1').lean() as any)).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('uses the approved template when one is configured', async () => {
    cloud(); process.env.WHATSAPP_TEMPLATE = 'owner_report'; await queue('t1');
    const f = reply(200); vi.stubGlobal('fetch', f);
    await sendQueued();
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toMatchObject({ type: 'template', template: { name: 'owner_report', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Hello पूरा' }] }] } });
  });

  it('a server error is retried and finally failed; a rejection (bad number) fails at once', async () => {
    cloud(); await queue('r1'); await queue('r2', '9829000000');
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => new Response(JSON.stringify({ error: { message: 'x' } }), { status: JSON.parse(init.body).to === '919829000000' ? 400 : 503 })));
    expect(await sendQueued()).toMatchObject({ retry: 1, failed: 1 });
    expect((await Notification.findById('r2').lean() as any)).toMatchObject({ status: 'failed', attempts: 1 });
    expect((await Notification.findById('r1').lean() as any)).toMatchObject({ status: 'queued', attempts: 1 });
    for (let i = 1; i < MAX_ATTEMPTS; i++) await sendQueued();
    expect((await Notification.findById('r1').lean() as any)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
    expect((await call(owner, list.GET as never, '/api/notifications')).json.data.map((n: any) => n.status).sort()).toEqual(['failed', 'failed']);
  });

  it('a network failure is retried, and a message stuck in "sending" is put back after 15 minutes', async () => {
    cloud(); await queue('n1');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await sendQueued()).toMatchObject({ retry: 1 });
    await Notification.collection.updateOne({ _id: 'n1' as any }, { $set: { status: 'sending', updatedAt: new Date(Date.now() - 20 * 60_000) } });
    await sendQueued(0);
    expect((await Notification.findById('n1').lean() as any).status).toBe('queued');
  });

  it('the hourly job retries and is skipped when run twice in the same hour', async () => {
    await queue('j1');
    const r = await runJob('send-notifications');
    expect(r).toMatchObject({ status: 'ok', skipped: false });
    expect((await runJob('send-notifications')).skipped).toBe(true);
  });
});
