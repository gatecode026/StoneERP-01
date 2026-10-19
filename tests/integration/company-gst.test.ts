/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { getSettings } from '@/lib/settings';
import * as settings from '@/app/api/settings/route';
import * as invoiceRoute from '@/app/api/sales/[id]/invoice/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, accountant: Who;
let sale: any;
const msg = (r: any) => JSON.stringify(r.json);
const put = (company: Record<string, unknown>) => call(owner, settings.PUT as never, '/api/settings', { method: 'PUT', body: { company } });
const invoice = () => call(accountant, invoiceRoute.POST as never, '/x', { method: 'POST', body: {}, params: { id: sale._id } });

beforeAll(async () => {
  db = await useTestDb('companygst');
  resetCaches();
  owner = await makeUser('owner');
  accountant = await makeUser('accountant');
  const item = (await api.create(owner, 'stockitems', { name: 'Slab', category: 'finished', unit: 'sq ft', openingBalance: 1000, sellRate: 100 })).json;
  const cust = (await api.create(owner, 'customers', { name: 'Jaipur Builders', mobile: '9811122222', state: 'Rajasthan' })).json;
  sale = (await api.create(owner, 'sales', { customerId: cust._id, stage: 'order', items: [{ stockItemId: item._id, name: 'Slab', qty: 100, unit: 'sq ft', rate: 100, gstRate: 18 }] })).json;
});
afterAll(async () => { await db.close(); });

describe('the company GST number, in Settings', () => {
  it('without it a GST bill cannot be issued, and the message says where to set it', async () => {
    expect((await getSettings()).company.gstin).toBe('');
    const r = await invoice();
    expect(r.status).toBe(409);
    expect(msg(r)).toMatch(/Settings → Company details/);
  });

  it('a GST number is 15 characters with a real state code, tidied to capitals', async () => {
    for (const bad of ['08ABCDE1234F1Z', '08ABCDE1234F1Z55', 'ABCDEFGHIJKLMNO', '99ABCDE1234F1Z5']) expect((await put({ gstin: bad })).status, bad).toBe(400);
    const ok = await put({ gstin: ' 08abcde1234f1z5 ' });
    expect(ok.status, msg(ok)).toBe(200);
    expect(ok.json.company.gstin).toBe('08ABCDE1234F1Z5');
  });

  it('the state code and the state must agree with the number', async () => {
    const clash = await put({ gstin: '07ABCDE1234F1Z5' }); // the code in Settings is still 08 (Rajasthan)
    expect(clash.status).toBe(400);
    expect(msg(clash)).toMatch(/does not match the GST number/);
    const wrongName = await put({ stateCode: '08', state: 'Gujarat' });
    expect(wrongName.status).toBe(400);
    expect(msg(wrongName)).toMatch(/State code 08 is Rajasthan/);
    const moved = await put({ gstin: '07ABCDE1234F1Z5', stateCode: '07', state: 'Delhi' }); // all three together
    expect(moved.status, msg(moved)).toBe(200);
    expect(moved.json.company).toMatchObject({ gstin: '07ABCDE1234F1Z5', stateCode: '07', state: 'Delhi' });
    expect((await put({ stateCode: '08', state: 'Rajasthan' })).status).toBe(400); // the number is Delhi's
    expect((await put({ gstin: '08ABCDE1234F1Z5', stateCode: '08', state: 'Rajasthan' })).status).toBe(200); // back to Rajasthan
  });

  it('phone, bank account, IFSC and email are checked', async () => {
    expect((await put({ phone: 'call me' })).status).toBe(400);
    expect((await put({ phone: '+91 98290-12345' })).status).toBe(200);
    expect((await put({ bankAccount: '12AB' })).status).toBe(400);
    expect((await put({ bankAccount: '123456789012' })).status).toBe(200);
    expect((await put({ ifsc: 'abc' })).status).toBe(400);
    expect((await put({ ifsc: 'sbin0001234' })).json.company.ifsc).toBe('SBIN0001234');
    expect((await put({ email: 'nope' })).status).toBe(400);
    expect((await put({ name: '' })).status).toBe(400);
  });

  it('once it is set the GST bill is issued, and the tax follows the company state (same state: CGST + SGST)', async () => {
    const r = await invoice();
    expect(r.status, msg(r)).toBe(200);
    expect(r.json.invoiceNo).toMatch(/^VSS\/\d{2}-\d{2}\/0001$/);
    expect((await api.get(owner, 'sales', sale._id)).json).toMatchObject({ taxType: 'cgst_sgst', cgst: 900, sgst: 900, total: 11800 });
  });

  it('a company in another state charges IGST to a customer here', async () => {
    const item = (await api.create(owner, 'stockitems', { name: 'Kerb', category: 'finished', unit: 'pieces', openingBalance: 100, sellRate: 100 })).json;
    expect((await put({ gstin: '07ABCDE1234F1Z5', stateCode: '07', state: 'Delhi' })).status).toBe(200);
    const cust = (await api.create(owner, 'customers', { name: 'Kota Traders', mobile: '9811133333', state: 'Rajasthan' })).json;
    const s2 = (await api.create(owner, 'sales', { customerId: cust._id, stage: 'order', items: [{ stockItemId: item._id, name: 'Kerb', qty: 10, unit: 'pieces', rate: 100, gstRate: 18 }] })).json;
    expect(s2).toMatchObject({ taxType: 'igst', igst: 180 });
  });
});
