/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, PNG, type Who } from '../api';
import { Expense } from '@/lib/models';
import { getStorage } from '@/lib/storage';
import { FileObject } from '@/lib/storage/files';
import { migratePhotos } from '@/lib/storage/migrate';
import * as files from '@/app/api/files/[...key]/route';
import * as upload from '@/app/api/files/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, sup: Who, sup2: Who, acc: Who;

const getFile = (w: Who, key: string, qs = '') => call(w, files.GET as never, `/api/files/${key}${qs}`, { params: { key: key as any } as any });
const uploadReq = (w: Who, form: FormData) => {
  const req = new NextRequest('http://localhost/api/files', { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', cookie: w.cookie }, body: form });
  return (upload.POST as any)(req, { params: Promise.resolve({}) }) as Promise<Response>;
};

beforeAll(async () => {
  db = await useTestDb('storage');
  resetCaches();
  owner = await makeUser('owner');
  sup = await makeUser('supervisor', { empCode: 'E900' });
  sup2 = await makeUser('supervisor', { empCode: 'E950' });
  acc = await makeUser('accountant');
  await api.create(owner, 'employees', { empCode: 'E001', name: 'Ramesh', job: 'Helper', supervisorCode: 'E900', payType: 'daily', rate: 500 });
});
afterAll(async () => { await db.close(); });

describe('photos never live in MongoDB', () => {
  let exp: any;
  it('an inline photo is stored as a file; the record keeps only a key', async () => {
    const r = await api.create(sup, 'expenses', { head: 'Diesel', amount: 500, paidBy: 'UPI', billPhoto: PNG });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    exp = r.json;
    expect(exp.billPhoto).toMatch(/^photos\/\d{4}\/\d{2}\/[0-9a-f-]+\.jpg$/);
    const raw: any = await Expense.findById(exp._id).lean();
    expect(JSON.stringify(raw)).not.toContain('data:');
    expect(raw.hasBill).toBe(true);
    const f: any = await FileObject.findById(exp.billPhoto).lean();
    expect(f).toMatchObject({ resource: 'expenses', kind: 'photos', contentType: 'image/jpeg' });
    expect(await getStorage().exists(exp.billPhoto)).toBe(true);
    expect(await getStorage().exists(f.thumbKey)).toBe(true);
  });
  it('lists carry no photo field at all', async () => {
    const list = await api.list(sup, 'expenses');
    expect(list.json.data[0]).not.toHaveProperty('billPhoto');
    expect(list.json.data[0].hasBill).toBe(true);
    expect(JSON.stringify(list.json).length).toBeLessThan(5000);
  });
  it('the file is served to its owner (and thumbnails too), and is a real JPEG', async () => {
    const r = await getFile(sup, exp.billPhoto);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await getFile(sup, exp.billPhoto, '?thumb=1')).status).toBe(200);
  });
  it('another supervisor cannot fetch it; the accountant (all expenses) can; anonymous cannot', async () => {
    expect((await getFile(sup2, exp.billPhoto)).status).toBe(404);
    expect((await getFile(acc, exp.billPhoto)).status).toBe(200);
    expect((await call(null, files.GET as never, `/api/files/${exp.billPhoto}`, { params: { key: exp.billPhoto as any } as any })).status).toBe(401);
    expect((await getFile(acc, '../etc/passwd')).status).toBe(404);
    expect((await getFile(acc, 'photos/2026/01/not-a-real-file.jpg')).status).toBe(404);
  });
  it('re-saving a record with its existing key keeps it; unchanged keys are not re-uploaded', async () => {
    const before = await FileObject.countDocuments();
    const r = await api.patch(acc, 'expenses', exp._id, { narration: 'x', billPhoto: exp.billPhoto });
    expect(r.status).toBe(200);
    expect(await FileObject.countDocuments()).toBe(before);
  });
});

describe('uploads are validated by content, not by what the client claims', () => {
  it('rejects text/HTML/SVG dressed up as an image', async () => {
    const html = 'data:image/png;base64,' + Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
    const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    expect((await api.create(sup, 'expenses', { head: 'Diesel', amount: 5, paidBy: 'UPI', billPhoto: html })).status).toBe(400);
    expect((await api.create(sup, 'expenses', { head: 'Diesel', amount: 5, paidBy: 'UPI', billPhoto: svg })).status).toBe(400);
  });
  it('strips EXIF metadata (GPS) and shrinks large photos', async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#b5651d' } }).jpeg().withExif({ IFD0: { Copyright: 'secret-owner', Software: 'cam' } }).toBuffer();
    const r = await api.create(sup, 'expenses', { head: 'Diesel', amount: 5, paidBy: 'UPI', billPhoto: 'data:image/jpeg;base64,' + big.toString('base64') });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const obj = await getStorage().get(r.json.billPhoto);
    const meta = await sharp(obj!.body).metadata();
    expect(meta.width).toBeLessThanOrEqual(1600);
    expect(meta.exif).toBeUndefined();
    expect(obj!.body.includes(Buffer.from('secret-owner'))).toBe(false);
  });
  it('direct upload: PDFs are allowed only for documents; images need permission on the target resource', async () => {
    const pdf = new File([Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF')], 'gst.pdf', { type: 'application/pdf' });
    const form = (file: File, resource: string, kind: string) => { const f = new FormData(); f.set('file', file); f.set('resource', resource); f.set('kind', kind); return f; };
    const okDoc = await uploadReq(acc, form(pdf, 'documents', 'docs'));
    expect(okDoc.status).toBe(201);
    expect((await uploadReq(acc, form(pdf, 'expenses', 'photos'))).status).toBe(400);
    expect((await uploadReq(sup, form(pdf, 'documents', 'docs'))).status).toBe(403); // a supervisor cannot add papers
    const png = new File([Buffer.from(PNG.split(',')[1], 'base64')], 'a.png', { type: 'image/png' });
    expect((await uploadReq(sup, form(png, 'expenses', 'photos'))).status).toBe(201);
    expect((await uploadReq(sup, form(png, 'salarysheets', 'photos'))).status).toBe(403);
  });
  it('Aadhaar / passbook images are readable only with personal-data access', async () => {
    const emp = (await api.list(owner, 'employees', 'empCode=E001')).json.data[0];
    const r = await api.patch(owner, 'employees', emp._id, { docAadhaar: PNG });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const detail = (await api.get(owner, 'employees', emp._id)).json;
    expect(detail.docAadhaar).toMatch(/^docs\//);
    expect((await getFile(owner, detail.docAadhaar)).status).toBe(200);
    expect((await getFile(sup, detail.docAadhaar)).status).toBe(404); // masked-only role
    const list = (await api.list(sup, 'employees')).json.data.find((e: any) => e.empCode === 'E001');
    expect(list.docFlags.aadhaar).toBe(true);
    expect(JSON.stringify(list)).not.toContain(detail.docAadhaar);
  });
});

describe('migration of the demo’s base64 photos', () => {
  it('dry run counts, apply moves and verifies, a second run finds nothing', async () => {
    const col = mongoose.connection.collection('expenses');
    const old = await col.insertMany([
      { date: '2026-01-01', head: 'Old', amount: 10, paidBy: 'Cash', billPhoto: PNG, isVoid: false, status: 'approved', createdAt: new Date(), updatedAt: new Date() },
      { date: '2026-01-02', head: 'Old', amount: 20, paidBy: 'Cash', billPhoto: PNG, isVoid: false, status: 'approved', createdAt: new Date(), updatedAt: new Date() },
    ]);
    const dry = await migratePhotos({ apply: false });
    expect(dry.moved).toBeGreaterThanOrEqual(2);
    expect(await col.countDocuments({ billPhoto: /^data:/ })).toBe(2);
    const res = await migratePhotos({ apply: true });
    expect(res.failed).toEqual([]);
    expect(await col.countDocuments({ billPhoto: /^data:/ })).toBe(0);
    const doc: any = await col.findOne({ _id: old.insertedIds[0] });
    expect(doc.billPhoto).toMatch(/^photos\//);
    expect(doc.hasBill).toBe(true);
    expect(await getStorage().exists(doc.billPhoto)).toBe(true);
    const again = await migratePhotos({ apply: true });
    expect(again.moved).toBe(0);
  });
});

describe('production refuses the local driver', () => {
  it('requires S3 / Cloudinary in production', async () => {
    const { setStorageForTests, getStorage: gs } = await import('@/lib/storage');
    setStorageForTests(null);
    const keep = { d: process.env.STORAGE_DRIVER, n: process.env.NODE_ENV };
    (process.env as any).NODE_ENV = 'production';
    process.env.STORAGE_DRIVER = 'local';
    expect(() => gs()).toThrow(/not allowed in production/);
    process.env.STORAGE_DRIVER = 's3';
    expect(() => gs()).toThrow(/S3_BUCKET/);
    (process.env as any).NODE_ENV = keep.n;
    process.env.STORAGE_DRIVER = keep.d;
    setStorageForTests(null);
  });
});
