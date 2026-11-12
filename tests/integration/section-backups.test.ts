/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { useTestDb } from '../helpers';
import { api, makeUser, resetCaches, type Who } from '../api';
import {
  BACKUP_SECTIONS,
  getSectionMeta,
} from '@/lib/export/sectionBackup';
import { Expense, Project } from '@/lib/models';
import { addDays, monthOf, todayIST } from '@/lib/time';
import * as sectionsRoute from '@/app/api/backups/sections/route';
import * as downloadRoute from '@/app/api/backups/download/route';
import * as downloadAllRoute from '@/app/api/backups/download-all/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, worker: Who;

beforeAll(async () => {
  db = await useTestDb('section_backups');
  resetCaches();
  owner = await makeUser('owner');
  worker = await makeUser('worker', { empCode: 'W001' });

  // Seed sample data for testing
  const empRes = await api.create(owner, 'employees', {
    name: 'Vipul Sharma',
    mobile: '9829011111',
    job: 'Operator',
    payType: 'daily',
    rate: 800,
  });
  expect(empRes.status).toBe(201);

  const stockRes = await api.create(owner, 'stockitems', {
    name: 'Kotah Stone Polished 22mm',
    category: 'finished',
    unit: 'sq ft',
  });
  expect(stockRes.status).toBe(201);

  const custRes = await api.create(owner, 'customers', {
    name: 'Royal Heritage Builders',
    mobile: '9829099999',
    city: 'Jaipur',
  });
  expect(custRes.status).toBe(201);
});

afterAll(async () => {
  await db.close();
});

const getSections = (who: Who) =>
  (sectionsRoute.GET as any)(
    new NextRequest('http://localhost/api/backups/sections', {
      headers: { host: 'localhost', origin: 'http://localhost', cookie: who.cookie },
    })
  ) as Promise<Response>;

const getDownload = (who: Who, qs: string) =>
  (downloadRoute.GET as any)(
    new NextRequest(`http://localhost/api/backups/download?${qs}`, {
      headers: { host: 'localhost', origin: 'http://localhost', cookie: who.cookie },
    })
  ) as Promise<Response>;

const getDownloadAll = (who: Who, qs: string) =>
  (downloadAllRoute.GET as any)(
    new NextRequest(`http://localhost/api/backups/download-all?${qs}`, {
      headers: { host: 'localhost', origin: 'http://localhost', cookie: who.cookie },
    })
  ) as Promise<Response>;

describe('Backups & Data Export System', () => {
  it('defines 24 ERP sections with metadata and column specs', () => {
    expect(BACKUP_SECTIONS.length).toBe(24);
    const emp = getSectionMeta('employees');
    expect(emp).toBeDefined();
    expect(emp?.name).toBe('Employees & Staff');
  });

  it('GET /api/backups/sections returns summary with record counts for Owner', async () => {
    const res = await getSections(owner);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.sections.length).toBe(24);
    expect(data.totalRecords).toBeGreaterThanOrEqual(3);

    const empSec = data.sections.find((s: any) => s.id === 'employees');
    expect(empSec).toBeDefined();
    expect(empSec.count).toBeGreaterThanOrEqual(1);

    const stockSec = data.sections.find((s: any) => s.id === 'stockitems');
    expect(stockSec).toBeDefined();
    expect(stockSec.count).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/backups/sections is forbidden for worker without backups permission', async () => {
    const res = await getSections(worker);
    expect(res.status).toBe(403);
  });

  it('downloads single section in Excel (.xlsx) format matching import columns', async () => {
    const res = await getDownload(owner, 'section=employees&format=xlsx');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(res.headers.get('content-disposition')).toMatch(/employees-backup-\d{4}-\d{2}-\d{2}\.xlsx/);

    const arrayBuf = await res.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(arrayBuf) as any);
    const ws = wb.worksheets[0];

    // Header row should have Employee import columns
    const headers = ws.getRow(1).values as any[];
    expect(headers).toContain('Employee code');
    expect(headers).toContain('Name');
    expect(headers).toContain('Mobile');

    // Data rows
    expect(ws.rowCount).toBeGreaterThanOrEqual(2);
  });

  it('downloads single section in CSV format with UTF-8 BOM', async () => {
    const res = await getDownload(owner, 'section=stockitems&format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/stockitems-backup-\d{4}-\d{2}-\d{2}\.csv/);

    const buf = Buffer.from(await res.arrayBuffer());
    // Starts with UTF-8 BOM bytes 0xEF, 0xBB, 0xBF
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);

    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('Finish');
  });

  it('downloads single section in printable landscape PDF format', async () => {
    const res = await getDownload(owner, 'section=customers&format=pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/customers-backup-\d{4}-\d{2}-\d{2}\.pdf/);

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('bundles all sections into a single master ZIP archive', async () => {
    const res = await getDownloadAll(owner, 'format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/stoneerp-all-sections-csv-backup-\d{4}-\d{2}-\d{2}\.zip/);

    const zipBuf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(zipBuf);
    const filenames = Object.keys(zip.files);

    expect(filenames).toContain('README.txt');
    // nothing dated exists yet: the lists without dates are in their folder, and a section with no records has no file
    expect(filenames).toContain('Lists (no date)/06-employees.csv');
    expect(filenames).toContain('Lists (no date)/05-stockitems.csv');
    expect(filenames).toContain('Lists (no date)/09-customers.csv');
    expect(filenames.some((f) => f.includes('projects'))).toBe(false);
    expect(filenames.filter((f) => /^d{4}-d{2} /.test(f))).toEqual([]); // no month folders yet
  });

  it('worker is forbidden from downloading all sections ZIP', async () => {
    const res = await getDownloadAll(worker, 'format=xlsx');
    expect(res.status).toBe(403);
  });
});

// ---- Backup period: lifetime / this month / custom range ----
describe('Backup period (lifetime, this month, custom range)', () => {
  const today = todayIST();
  const ym = monthOf(today);
  const prevLast = addDays(`${ym}-01`, -1); // the last day of last month
  const old = '2020-03-05';
  const csvText = async (res: Response) => Buffer.from(await res.arrayBuffer()).toString('utf8');
  const count = async (qs: string, id = 'expenses') => (await (await getSectionsQs(owner, qs)).json()).sections.find((s: any) => s.id === id);

  beforeAll(async () => {
    // four expenses in different periods (inserted straight into the collection: this tests the backup, not the expense form)
    await Expense.collection.insertMany([
      { date: old, head: 'OldRent', amount: 100, isVoid: false, createdAt: new Date() },
      { date: prevLast, head: 'PrevDiesel', amount: 200, isVoid: false, createdAt: new Date() },
      { date: `${ym}-01`, head: 'ThisDiesel', amount: 300, isVoid: false, createdAt: new Date() },
      { date: today, head: 'TodayTea', amount: 400, isVoid: false, createdAt: new Date() },
      { date: today, head: 'VoidedTea', amount: 999, isVoid: true, createdAt: new Date() },
    ] as any[]);
  });

  const getSectionsQs = (who: Who, qs: string) =>
    (sectionsRoute.GET as any)(new NextRequest(`http://localhost/api/backups/sections?${qs}`, { headers: { host: 'localhost', origin: 'http://localhost', cookie: who.cookie } })) as Promise<Response>;

  it('lifetime (and no choice at all) holds every record, as before', async () => {
    expect((await count('')).count).toBe(4);
    expect((await count('range=lifetime')).count).toBe(4);
    const csv = await csvText(await getDownload(owner, 'section=expenses&format=csv'));
    for (const h of ['OldRent', 'PrevDiesel', 'ThisDiesel', 'TodayTea']) expect(csv).toContain(h);
    expect(csv).not.toContain('VoidedTea'); // cancelled records never go into a backup
  });

  it('this month holds only the current month, and the screen counts follow it', async () => {
    const r = await (await getSectionsQs(owner, 'range=month')).json();
    expect(r.range).toMatchObject({ mode: 'month', from: `${ym}-01` });
    expect(r.sections.find((s: any) => s.id === 'expenses')).toMatchObject({ count: 2, inPeriod: true });
    const csv = await csvText(await getDownload(owner, 'section=expenses&format=csv&range=month'));
    expect(csv).toContain('ThisDiesel');
    expect(csv).toContain('TodayTea');
    expect(csv).not.toContain('OldRent');
    expect(csv).not.toContain('PrevDiesel');
  });

  it('a custom range keeps its first and last day, and nothing outside', async () => {
    expect((await count(`range=custom&from=${prevLast}&to=${prevLast}`)).count).toBe(1); // one day
    expect((await count(`range=custom&from=${old}&to=${prevLast}`)).count).toBe(2); // both ends included
    expect((await count(`range=custom&from=2019-01-01&to=2019-12-31`)).count).toBe(0);
    const res = await getDownload(owner, `section=expenses&format=csv&range=custom&from=${prevLast}&to=${prevLast}`);
    expect(res.headers.get('content-disposition')).toContain(`expenses-backup-${prevLast}_to_${prevLast}.csv`);
    const csv = await csvText(res);
    expect(csv).toContain('PrevDiesel');
    expect(csv).not.toContain('ThisDiesel');
  });

  it('names the file after the period', async () => {
    expect((await getDownload(owner, 'section=expenses&format=csv&range=month')).headers.get('content-disposition')).toContain(`expenses-backup-month-${ym}.csv`);
    expect((await getDownload(owner, 'section=expenses&format=csv')).headers.get('content-disposition')).toContain(`expenses-backup-${today}.csv`);
  });

  it('Excel and PDF follow the period too', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await (await getDownload(owner, 'section=expenses&format=xlsx&range=month')).arrayBuffer()) as any);
    expect(wb.worksheets[0].rowCount).toBe(3); // the heading and the two records of this month
    const pdf = await getDownload(owner, 'section=expenses&format=pdf&range=month');
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('lists without dates (staff, customers, ...) stay whole in every period', async () => {
    const emp = await count('range=month', 'employees');
    expect(emp.inPeriod).toBe(false);
    expect(emp.count).toBeGreaterThanOrEqual(1);
    expect((await csvText(await getDownload(owner, 'section=employees&format=csv&range=custom&from=2019-01-01&to=2019-01-02')))).toContain('Vipul Sharma');
  });

  const monthFolder = (m: string) => `${m} ${new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' })}`;
  const idxOf = (id: string) => String(BACKUP_SECTIONS.findIndex((x) => x.id === id) + 1).padStart(2, '0');
  const zipOf = async (qs: string) => JSZip.loadAsync(Buffer.from(await (await getDownloadAll(owner, qs)).arrayBuffer()));
  const topFolders = (z: JSZip) => [...new Set(Object.keys(z.files).filter((n) => n.includes('/')).map((n) => n.split('/')[0]))];

  it('the ZIP opens on one folder per month, each with that month’s records, then the lists without dates', async () => {
    const z = await zipOf('format=csv');
    // oldest month first, the lists last
    expect(topFolders(z)).toEqual([monthFolder(old.slice(0, 7)), ...(prevLast.slice(0, 7) === ym ? [] : [monthFolder(prevLast.slice(0, 7))]), monthFolder(ym), 'Lists (no date)']);
    const exp = (m: string) => z.file(`${monthFolder(m)}/${idxOf('expenses')}-expenses.csv`)!.async('string');
    const oldCsv = await exp(old.slice(0, 7));
    expect(oldCsv).toContain('OldRent');
    expect(oldCsv).not.toContain('ThisDiesel');
    const nowCsv = await exp(ym);
    expect(nowCsv).toContain('ThisDiesel');
    expect(nowCsv).toContain('TodayTea');
    expect(nowCsv).not.toContain('OldRent');
    // the lists are whole, in their own folder; nothing is dated in them
    expect(await z.file(`Lists (no date)/${idxOf('employees')}-employees.csv`)!.async('string')).toContain('Vipul Sharma');
    expect(z.file(`${monthFolder(ym)}/${idxOf('employees')}-employees.csv`)).toBeNull();
    // a section with nothing in a month has no file there
    expect(z.file(`${monthFolder(old.slice(0, 7))}/${idxOf('sales')}-sales.csv`)).toBeNull();
    // every record is in the ZIP exactly once: the four expenses of the four dates
    const all = (await Promise.all(Object.keys(z.files).filter((n) => n.endsWith(`-expenses.csv`)).map((n) => z.file(n)!.async('string')))).join('');
    for (const h of ['OldRent', 'PrevDiesel', 'ThisDiesel', 'TodayTea']) expect(all.split(h).length - 1, h).toBe(1);
  });

  it('with every format, each month holds the data folders excel, csv and pdf', async () => {
    const z = await zipOf('format=all');
    const m = monthFolder(ym);
    for (const p of [`${m}/excel/${idxOf('expenses')}-expenses.xlsx`, `${m}/csv/${idxOf('expenses')}-expenses.csv`, `${m}/pdf/${idxOf('expenses')}-expenses.pdf`, `Lists (no date)/excel/${idxOf('employees')}-employees.xlsx`]) {
      expect(z.file(p), p).not.toBeNull();
    }
    expect(Buffer.from(await z.file(`${m}/pdf/${idxOf('expenses')}-expenses.pdf`)!.async('nodebuffer')).slice(0, 5).toString('ascii')).toBe('%PDF-');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await z.file(`${m}/excel/${idxOf('expenses')}-expenses.xlsx`)!.async('nodebuffer')) as any);
    expect(wb.worksheets[0].rowCount).toBe(3); // the heading and this month's two expenses
  });

  it('a record saved without a date is not lost: it goes to the lists folder of a lifetime backup, and is not in a period', async () => {
    await Project.collection.insertOne({ projectCode: 'PRJ-UNDATED', name: 'Undated Palace', isVoid: false, createdAt: new Date() } as any);
    const full = await zipOf('format=csv');
    expect(await full.file(`Lists (no date)/${idxOf('projects')}-projects.csv`)!.async('string')).toContain('Undated Palace');
    const month = await zipOf('format=csv&range=month');
    expect(Object.keys(month.files).some((n) => n.includes('projects'))).toBe(false);
  });

  it('the month ZIP has one month folder, says which period it is, and is named after it', async () => {
    const z = await zipOf('format=csv&range=month');
    expect(topFolders(z)).toEqual([monthFolder(ym), 'Lists (no date)']);
    const readme = await z.file('README.txt')!.async('string');
    expect(readme).toContain('Period: This month');
    expect(readme).toContain('One folder per month');
    expect(readme).toContain(monthFolder(ym));
    expect(await z.file(`${monthFolder(ym)}/${idxOf('expenses')}-expenses.csv`)!.async('string')).not.toContain('OldRent');
    const res = await getDownloadAll(owner, 'format=csv&range=month');
    expect(res.headers.get('content-disposition')).toContain(`stoneerp-all-sections-csv-backup-month-${ym}.zip`);
    expect(await (await zipOf('format=csv')).file('README.txt')!.async('string')).toContain('Period: Lifetime');
  });

  it('refuses a period that makes no sense (400), and still needs the right to back up (403)', async () => {
    for (const qs of ['range=custom', `range=custom&from=${today}`, `range=custom&from=${today}&to=${old}`, 'range=custom&from=2026-02-31&to=2026-03-01', 'range=week']) {
      expect((await getDownload(owner, `section=expenses&format=csv&${qs}`)).status, qs).toBe(400);
      expect((await getDownloadAll(owner, `format=csv&${qs}`)).status, qs).toBe(400);
      expect((await getSectionsQs(owner, qs)).status, qs).toBe(400);
    }
    expect((await getDownload(worker, 'section=expenses&format=csv&range=month')).status).toBe(403);
    expect((await getDownloadAll(worker, 'format=csv&range=month')).status).toBe(403);
  });
});
