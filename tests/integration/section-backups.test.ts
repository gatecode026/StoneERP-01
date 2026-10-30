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
  it('defines 21 ERP sections with metadata and column specs', () => {
    expect(BACKUP_SECTIONS.length).toBe(21);
    const emp = getSectionMeta('employees');
    expect(emp).toBeDefined();
    expect(emp?.name).toBe('Employees & Staff');
  });

  it('GET /api/backups/sections returns summary with record counts for Owner', async () => {
    const res = await getSections(owner);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.sections.length).toBe(21);
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
    expect(filenames.some((f) => f.includes('employees') && f.endsWith('.csv'))).toBe(true);
    expect(filenames.some((f) => f.includes('stockitems') && f.endsWith('.csv'))).toBe(true);
    expect(filenames.some((f) => f.includes('customers') && f.endsWith('.csv'))).toBe(true);
    expect(filenames.some((f) => f.includes('projects') && f.endsWith('.csv'))).toBe(true);
    expect(filenames.length).toBe(22); // 21 sections + 1 README.txt
  });

  it('worker is forbidden from downloading all sections ZIP', async () => {
    const res = await getDownloadAll(worker, 'format=xlsx');
    expect(res.status).toBe(403);
  });
});
