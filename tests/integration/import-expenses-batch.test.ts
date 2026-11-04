/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { useTestDb } from '../helpers';
import { makeUser, resetCaches, type Who } from '../api';
import { Expense, ExpenseHead, CashEntry, Account } from '@/lib/models';
import { todayIST } from '@/lib/time';
import * as route from '@/app/api/import/[resource]/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who;

beforeAll(async () => {
  db = await useTestDb('expensesbatch');
  resetCaches();
  owner = await makeUser('owner');
});
afterAll(async () => {
  await db.close();
});

async function sheet(rows: any[][], name = 'expenses.xlsx'): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  return new File([new Uint8Array(await wb.xlsx.writeBuffer())], name);
}

async function imp(key: string, rows: any[][], commit = true) {
  const fd = new FormData();
  fd.append('file', await sheet(rows));
  const req = new NextRequest(`http://localhost/api/import/${key}${commit ? '?commit=1' : ''}`, {
    method: 'POST',
    headers: { host: 'localhost', origin: 'http://localhost', cookie: owner.cookie },
    body: fd,
  });
  const res = await (route.POST as any)(req, { params: Promise.resolve({ resource: key }) });
  return { status: res.status as number, json: await res.json() };
}

describe('Bulk expense import with 68 rows', () => {
  it('imports 68 rows with identical expense head without write conflict', async () => {
    const today = todayIST();
    const ddmmyyyy = today.split('-').reverse().join('-');

    // 68 rows matching the user's spreadsheet structure
    const rows = [
      ['Date', 'Expense head', 'Amount', 'Paid by', 'Paid to', 'Spent by', 'For machine or site', 'Narration'],
      ...Array.from({ length: 68 }, (_, i) => [
        ddmmyyyy,
        'Factory Exp',
        i === 0 ? 830 : i === 1 ? 71000 : 260 + i,
        'Cash',
        'Vendor ' + (i + 1),
        'Perf Owner',
        'Factory',
        'Factory expense line ' + (i + 1),
      ]),
    ];

    // 1. Preview mode (commit=false)
    const preview = await imp('expenses', rows, false);
    expect(preview.status).toBe(200);
    expect(preview.json.valid).toBe(68);
    expect(preview.json.committed).toBe(false);

    // 2. Commit mode (commit=true)
    const committed = await imp('expenses', rows, true);
    expect(committed.status).toBe(200);
    expect(committed.json.committed).toBe(true);
    expect(committed.json.imported).toBe(68);

    // Verify Expense documents
    expect(await Expense.countDocuments({ head: 'Factory Exp' })).toBe(68);

    // Verify ExpenseHead was upserted once and exists
    const heads = await ExpenseHead.find({ name: 'Factory Exp' }).lean();
    expect(heads).toHaveLength(1);

    // Verify cash entries were posted
    const cashEntries = await CashEntry.countDocuments({ head: 'Factory Exp' });
    expect(cashEntries).toBe(68);

    // Verify cash account balance
    const cashAccount: any = await Account.findById('cash').lean();
    expect(cashAccount?.balance).toBeLessThan(0);
  });
});

