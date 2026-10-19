/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, PNG, type Who } from '../api';
import { getStorage, setStorageForTests } from '@/lib/storage';
import { FileObject } from '@/lib/storage/files';
import * as files from '@/app/api/files/[...key]/route';
import * as upload from '@/app/api/files/route';

// Every form that takes a photo, saved, edited ("Change") and read back, with the files kept in the database (the live site's storage).
let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who;
let machine: any, customer: any, slab: any, sale: any;

let PNG2 = ''; // another picture, so a "changed" photo is a different file (made in beforeAll)
const KEY = /^(photos|docs|signatures)\/\d{4}\/\d{2}\/[0-9a-f-]+\.jpg$/;
const getFile = (w: Who, key: string, qs = '') => call(w, files.GET as never, `/api/files/${key}${qs}`, { params: { key: key as any } as any });
const send = (w: Who, form: FormData) => (upload.POST as any)(new NextRequest('http://localhost/api/files', { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', cookie: w.cookie }, body: form }), { params: Promise.resolve({}) }) as Promise<Response>;
const asFile = (dataUrl: string, name = 'p.png', type = 'image/png') => new File([Buffer.from(dataUrl.split(',')[1], 'base64')], name, { type });
let n = 0;

beforeAll(async () => {
  db = await useTestDb('uploadsall');
  PNG2 = 'data:image/png;base64,' + (await sharp({ create: { width: 3, height: 2, channels: 3, background: '#cc3300' } }).png().toBuffer()).toString('base64');
  process.env.STORAGE_DRIVER = 'mongo'; // what the live site uses
  setStorageForTests(null);
  resetCaches();
  owner = await makeUser('owner');
  await api.create(owner, 'employees', { empCode: 'E001', name: 'Ramesh', job: 'Helper', payType: 'daily', rate: 500 });
  machine = (await api.create(owner, 'machines', { name: 'Gang saw U', type: 'Gang saw' })).json;
  customer = (await api.create(owner, 'customers', { name: 'Upload Buyer', mobile: '9827011111' })).json;
  slab = (await api.create(owner, 'stockitems', { name: 'Slab U', category: 'finished', unit: 'sq ft', openingBalance: 5000, sellRate: 60 })).json;
  sale = (await api.create(owner, 'sales', { customerId: customer._id, stage: 'order', items: [{ stockItemId: slab._id, name: 'Slab U', qty: 100, unit: 'sq ft', rate: 60, gstRate: 0 }] })).json;
});
afterAll(async () => { setStorageForTests(null); await db.close(); });

/** One form: how it is created, which fields hold pictures (a field marked [] holds a list of them). */
const FORMS: { name: string; resource: string; body: () => Record<string, unknown>; fields: string[] }[] = [
  { name: 'Employee: profile photo and the four documents', resource: 'employees', body: () => ({ name: `Upload Person ${++n}`, job: 'Helper', payType: 'daily', rate: 500, mobile: `98270${String(10000 + n)}` }), fields: ['photo', 'docAadhaar', 'docPan', 'docPassbook', 'docLicense'] },
  { name: 'Expense: bill photo', resource: 'expenses', body: () => ({ head: 'Diesel', amount: 500, paidBy: 'UPI' }), fields: ['billPhoto'] },
  { name: 'Important paper: the file', resource: 'documents', body: () => ({ name: `Licence ${++n}` }), fields: ['file'] },
  { name: 'Daily work report: photos []', resource: 'dailyreports', body: () => ({ empCode: 'E001', narration: 'Cut pavers', quantity: 100 }), fields: ['photos[]'] },
  { name: 'Safety: photo and signature', resource: 'safetyrecords', body: () => ({ kind: 'accident', empCode: 'E001', severity: 'Minor', where: 'Yard', what: 'Slipped' }), fields: ['photo', 'signature'] },
  { name: 'Machine work entry: photo', resource: 'machineentries', body: () => ({ shift: 'Day', machineId: machine._id, operatorCode: 'E001', startTime: '09:00', stopTime: '17:00', outputSqft: 120 }), fields: ['photo'] },
  { name: 'Block entry: block photo and rawanna photo', resource: 'blocks', body: () => ({ rawanna: `UP-${++n}`, length: 8, width: 5, height: 4 }), fields: ['photo', 'rawannaPhoto'] },
  { name: 'Machine repair: photo', resource: 'repairs', body: () => ({ kind: 'breakdown', machineId: machine._id, problem: 'Bearing noise' }), fields: ['photo'] },
  { name: 'Vehicle: RC photo', resource: 'vehicles', body: () => ({ name: `Truck ${++n}`, kind: 'Truck', regNo: `RJ14GA${String(1000 + n)}` }), fields: ['rcPhoto'] },
  { name: 'Stock item: photo', resource: 'stockitems', body: () => ({ name: `Item ${++n}`, category: 'finished', unit: 'sq ft' }), fields: ['photo'] },
  { name: 'Complaint: photos []', resource: 'complaints', body: () => ({ customerId: customer._id, problem: 'Broken pieces', details: '4 slabs cracked' }), fields: ['photos[]'] },
  { name: 'Loading slip: loaded and covered photos, papers []', resource: 'dispatches', body: () => ({ saleId: sale._id, truckNo: `RJ14 GA ${String(2000 + ++n)}`, items: [{ stockItemId: slab._id, name: 'Slab U', qty: 1 }] }), fields: ['photoLoaded', 'photoCovered', 'documents[]'] },
];

const asValue = (field: string, pic: string) => (field.endsWith('[]') ? [pic, pic] : pic);
const keysOf = (field: string, doc: any): string[] => { const v = doc[field.replace('[]', '')]; return Array.isArray(v) ? v : v ? [v] : []; };

describe('the live site keeps files in the database', () => {
  it('with nothing chosen, production uses the database; developing uses a folder', () => {
    expect(getStorage().name).toBe('mongo'); // set explicitly above
    const keep = process.env.STORAGE_DRIVER;
    delete process.env.STORAGE_DRIVER;
    vi.stubEnv('NODE_ENV', 'production');
    setStorageForTests(null);
    expect(getStorage().name).toBe('mongo');
    vi.unstubAllEnvs();
    setStorageForTests(null);
    expect(getStorage().name).toBe('local');
    process.env.STORAGE_DRIVER = keep;
    setStorageForTests(null);
    expect(getStorage().name).toBe('mongo');
  });
});

describe.each(FORMS)('$name', (form) => {
  let doc: any;
  it('saves with the pictures, keeping only keys; every picture is a real JPEG that can be opened', async () => {
    const body: Record<string, unknown> = form.body();
    for (const f of form.fields) body[f.replace('[]', '')] = asValue(f, PNG);
    const r = await api.create(owner, form.resource, body);
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    doc = (await api.get(owner, form.resource, r.json._id)).json;
    for (const f of form.fields) {
      const ks = keysOf(f, doc);
      expect(ks.length, `${f} was saved`).toBe(f.endsWith('[]') ? 2 : 1);
      for (const k of ks) {
        expect(k, f).toMatch(KEY);
        expect(await getStorage().exists(k), `${f} is in storage`).toBe(true);
        const g = await getFile(owner, k);
        expect(g.status, `${f} opens`).toBe(200);
        expect(g.headers.get('content-type')).toBe('image/jpeg');
        expect((await sharp(Buffer.from(await g.res.arrayBuffer())).metadata()).format).toBe('jpeg');
        const t = await getFile(owner, k, '?thumb=1');
        expect(t.status, `${f} thumbnail`).toBe(200);
      }
    }
    expect(JSON.stringify(await (mongoose.connection.collection(form.resource).findOne({ _id: new mongoose.Types.ObjectId(doc._id) })))).not.toContain('data:');
  });

  it('edits: a changed picture is stored again and the record points at the new file', async () => {
    const edits = form.fields.filter((f) => !f.endsWith('[]') || form.resource !== 'dispatches'); // a loading slip is not edited after it is saved
    if (form.resource === 'dispatches') return; // covered by its own late-details flow
    const patch: Record<string, unknown> = {};
    for (const f of edits) patch[f.replace('[]', '')] = asValue(f, PNG2);
    const r = await api.patch(owner, form.resource, doc._id, patch);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const after = (await api.get(owner, form.resource, doc._id)).json;
    for (const f of edits) {
      const was = keysOf(f, doc), now = keysOf(f, after);
      expect(now.length, f).toBe(was.length);
      expect(now.every((k) => !was.includes(k)), `${f} points at the new file`).toBe(true);
      for (const k of now) expect((await getFile(owner, k)).status).toBe(200);
    }
  });

  it('refuses a file that is not a picture, with a clear message (not a crash)', async () => {
    const body: Record<string, unknown> = form.body();
    const f = form.fields[0];
    body[f.replace('[]', '')] = asValue(f, 'data:image/png;base64,AAAAAAAA');
    const r = await api.create(owner, form.resource, body);
    expect(r.status, JSON.stringify(r.json)).toBe(400);
    expect(JSON.stringify(r.json)).toMatch(/not a valid image|damaged|Must be an image|valid file|Only JPEG/i);
  });
});

describe('the upload endpoint (a file chosen before the form is saved)', () => {
  it('takes a photo and a PDF paper, and refuses a PDF where only photos are allowed and a program disguised as a picture', async () => {
    const fd = (file: File, kind: string, resource: string) => { const f = new FormData(); f.set('file', file); f.set('kind', kind); f.set('resource', resource); return f; };
    const ok = await send(owner, fd(asFile(PNG2), 'photos', 'expenses'));
    expect(ok.status).toBe(201);
    const stored = await ok.json();
    expect(stored.key).toMatch(KEY);
    expect((await getFile(owner, stored.key)).status).toBe(200);
    expect(await FileObject.findById(stored.key).lean()).toMatchObject({ resource: 'expenses', kind: 'photos' });

    const pdf = new File([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')], 'paper.pdf', { type: 'application/pdf' });
    const asPaper = await send(owner, fd(pdf, 'docs', 'documents'));
    expect(asPaper.status, await asPaper.clone().text()).toBe(201);
    const paper = await asPaper.json();
    const back = await getFile(owner, paper.key);
    expect(back.status).toBe(200);
    expect(back.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await back.res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');

    expect((await send(owner, fd(pdf, 'photos', 'expenses'))).status).toBe(400); // a PDF is not a photo
    const exe = new File([Buffer.from('MZ\x90\x00 not a picture')], 'x.png', { type: 'image/png' });
    expect((await send(owner, fd(exe, 'photos', 'expenses'))).status).toBe(400);
    expect((await send(owner, fd(asFile(PNG), 'photos', 'nothing-like-this'))).status).toBe(400);
  });

  it('removing a file removes its bytes; an unknown key is not found', async () => {
    const ok = await (await send(owner, (() => { const f = new FormData(); f.set('file', asFile(PNG)); f.set('kind', 'photos'); f.set('resource', 'expenses'); return f; })())).json();
    await getStorage().remove(ok.key);
    expect(await getStorage().exists(ok.key)).toBe(false);
    expect((await getFile(owner, 'photos/2026/10/00000000-0000-0000-0000-000000000000.jpg')).status).toBe(404);
  });
});
