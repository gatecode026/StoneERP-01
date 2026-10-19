/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, makeUser, resetCaches, type Who } from '../api';
import { Account, Customer, Sale } from '@/lib/models';
import { addDays, todayIST } from '@/lib/time';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who;
let item: any;
const today = todayIST();
let n = 0;
const mobileN = () => '98290' + String(10000 + ++n).padStart(5, '0');
const cust = (extra: Record<string, unknown> = {}) => api.create(owner, 'customers', { name: `Party ${++n}`, mobile: mobileN(), ...extra });
const line = (extra: Record<string, unknown> = {}) => ({ stockItemId: item._id, name: item.name, qty: 100, unit: 'sq ft', rate: 50, gstRate: 0, ...extra });
const order = async (extra: Record<string, unknown> = {}) => (await api.create(owner, 'sales', { customerId: (await cust()).json._id, stage: 'order', items: [line()], ...extra })).json;
const msg = (r: any) => JSON.stringify(r.json);

beforeAll(async () => {
  db = await useTestDb('salesvalid');
  resetCaches();
  owner = await makeUser('owner');
  item = (await api.create(owner, 'stockitems', { name: 'Slab 600x600x30', category: 'finished', unit: 'sq ft', openingBalance: 5000, sellRate: 50 })).json;
});
afterAll(async () => { await db.close(); });

describe('customer form: mobile, name, GST number', () => {
  it('a mobile number is 10 digits starting 6-9: a +91 or spaces are tidied, letters and short numbers are refused', async () => {
    const a = await cust({ mobile: '+91 98290-55555' });
    expect(a.status, msg(a)).toBe(201);
    expect(a.json.mobile).toBe('9829055555');
    expect((await cust({ mobile: '98290 55556' })).json.mobile).toBe('9829055556');
    for (const bad of ['abcdefghij', '98290abcde', '12345', '1234567890', '98290555', '9999999999', '98290555551']) {
      const r = await cust({ mobile: bad });
      expect(r.status, `${bad} ${msg(r)}`).toBe(400);
    }
    expect((await api.patch(owner, 'customers', a.json._id, { mobile: 'not a number' })).status).toBe(400);
    expect((await api.patch(owner, 'customers', a.json._id, { mobile: '9829055557' })).json.mobile).toBe('9829055557');
  });

  it('a name starts with a letter or digit and has no formula characters', async () => {
    expect((await cust({ name: '3M Stone Traders & Co.' })).status).toBe(201);
    expect((await cust({ name: '  Delhi   Builders ' })).json.name).toBe('Delhi Builders');
    for (const bad of ['A', '=cmd|calc', '@home', '<b>x</b>', '   ']) expect((await cust({ name: bad })).status, bad).toBe(400);
  });

  it('a GST number is 15 characters with a real state code; capitals and spaces are tidied', async () => {
    const ok = await cust({ gstin: '08aaaaa0000a1z5 ' });
    expect(ok.status, msg(ok)).toBe(201);
    expect(ok.json.gstin).toBe('08AAAAA0000A1Z5');
    for (const bad of ['08AAAAA0000A1Z', '08AAAAA0000A1Z55', 'AAAAAAAAAAAAAAA', '99AAAAA0000A1Z5', '08AAAAA00OOA1Z5']) expect((await cust({ gstin: bad })).status, bad).toBe(400);
  });

  it('the state comes from the GST number, a state is a real one, and the two cannot disagree', async () => {
    const delhi = await cust({ gstin: '07AAAAA0000A1Z5' });
    expect(delhi.json).toMatchObject({ state: 'Delhi', country: 'India', type: 'Domestic' });
    expect((await cust({ gstin: '07CCCCC3333C1Z5', state: 'delhi' })).json.state).toBe('Delhi');
    const clash = await cust({ gstin: '07AAAAA0000A1Z5', state: 'Rajasthan' });
    expect(clash.status).toBe(400);
    expect(msg(clash)).toMatch(/belongs to Delhi/);
    expect((await cust({ state: 'Rajsthan' })).status).toBe(400); // a typo would have decided the tax wrongly
    expect((await cust({})).json.state).toBe('Rajasthan'); // no state and no GST number: our own state
  });

  it('domestic or export: an export customer is abroad, a domestic one is in India, and the type decides the tax', async () => {
    expect((await cust({ type: 'Export', country: 'India' })).status).toBe(400);
    expect((await cust({ type: 'Export' })).status).toBe(400); // no country given: it reads as India
    expect((await cust({ type: 'Domestic', country: 'Nepal' })).status).toBe(400);
    const abroad = await cust({ type: 'Export', country: ' Nepal ' });
    expect(abroad.status, msg(abroad)).toBe(201);
    expect(abroad.json).toMatchObject({ type: 'Export', country: 'Nepal' });
    const noType = await cust({ country: 'UAE' }); // an old form that sent only the country
    expect(noType.json.type).toBe('Export');
    const sale = (await api.create(owner, 'sales', { customerId: abroad.json._id, stage: 'order', items: [line({ gstRate: 18 })] })).json;
    expect(sale).toMatchObject({ taxType: 'export', total: 5000 }); // no GST on an export bill
  });

  it('the same mobile or GST number on another customer is asked about first', async () => {
    const a = (await cust({ gstin: '08BBBBB1111B1Z5' })).json;
    const sameMobile = await cust({ mobile: a.mobile });
    expect(sameMobile.status).toBe(409);
    expect(msg(sameMobile)).toMatch(/already has this mobile number/);
    expect((await cust({ mobile: a.mobile, _confirmed: true })).status).toBe(201);
    const sameGst = await cust({ gstin: '08BBBBB1111B1Z5' });
    expect(sameGst.status).toBe(409);
    expect(msg(sameGst)).toMatch(/already has this GST number/);
    expect((await cust({ gstin: '08BBBBB1111B1Z5', _confirmed: true })).status).toBe(201);
    // editing a customer without touching the mobile does not ask about it
    expect((await api.patch(owner, 'customers', a._id, { city: 'Kota' })).status).toBe(200);
  });
});

describe('quotation and order', () => {
  it('no future date, no product on two lines, an advance within the total', async () => {
    const c = (await cust()).json;
    const make = (extra: Record<string, unknown>) => api.create(owner, 'sales', { customerId: c._id, items: [line()], ...extra });
    expect((await make({ date: addDays(today, 2) })).status).toBe(400);
    const twice = await make({ items: [line(), line({ qty: 5 })] });
    expect(twice.status).toBe(400);
    expect(msg(twice)).toMatch(/two lines/);
    expect((await make({ stage: 'order', advance: 999999 })).status).toBe(400); // more than the total
    expect((await make({ stage: 'order', advance: -5 })).status).toBe(400);
    expect((await make({ items: [line({ qty: 0 })] })).status).toBe(400);
    expect((await make({ items: [line({ rate: -1 })] })).status).toBe(400);
    const q = await make({});
    expect(q.status, msg(q)).toBe(201);
  });

  it('a quotation can be changed (items, date) until it is an order; an order cannot', async () => {
    const q = (await api.create(owner, 'sales', { customerId: (await cust()).json._id, items: [line()] })).json;
    expect(q).toMatchObject({ stage: 'quotation', total: 5000 });
    const up = await api.patch(owner, 'sales', q._id, { items: [line({ qty: 40, rate: 60 })] });
    expect(up.status, msg(up)).toBe(200);
    expect(up.json.total).toBe(2400);
    expect((await api.patch(owner, 'sales', q._id, { date: addDays(today, 3) })).status).toBe(400);
    expect((await api.patch(owner, 'sales', q._id, { items: [line(), line()] })).status).toBe(400);
    const o = await order();
    expect((await api.patch(owner, 'sales', o._id, { items: [line({ qty: 1 })] })).status).toBe(409);
  });

  it('a quotation or an order can be cancelled with a reason, until money or a bill is involved', async () => {
    const c = (await cust()).json;
    const o = (await api.create(owner, 'sales', { customerId: c._id, stage: 'order', items: [line()] })).json;
    expect(((await Customer.findById(c._id).lean()) as any).outstanding).toBe(5000);
    expect((await api.void(owner, 'sales', o._id, 'customer changed his mind')).status).toBe(200);
    expect(((await Customer.findById(c._id).lean()) as any).outstanding).toBe(0);
    const paid = (await api.create(owner, 'sales', { customerId: c._id, stage: 'order', items: [line()], advance: 1000, advanceMode: 'UPI' })).json;
    expect((await api.void(owner, 'sales', paid._id, 'x')).status).toBe(409); // cancel the payment first
  });
});

describe('payments', () => {
  it('a cheque carries its 6-digit number; UPI and bank references are plain text', async () => {
    const o = await order();
    const pay = (extra: Record<string, unknown>) => api.create(owner, 'payments', { saleId: o._id, amount: 100, mode: 'UPI', ...extra });
    const noNo = await pay({ mode: 'Cheque' });
    expect(noNo.status).toBe(400);
    expect(msg(noNo)).toMatch(/cheque number/i);
    expect((await pay({ mode: 'Cheque', ref: '12345' })).status).toBe(400);
    expect((await pay({ mode: 'Cheque', ref: 'ABC123' })).status).toBe(400);
    expect((await pay({ mode: 'Cheque', ref: '123456' })).status).toBe(201);
    expect((await pay({ ref: 'UPI/4521-AB' })).status).toBe(201);
    expect((await pay({ ref: '<script>' })).status).toBe(400);
    expect((await pay({ ref: 'x'.repeat(41) })).status).toBe(400);
  });

  it('not more than is pending, not in the future, not before the order, not zero or negative', async () => {
    const o = await order({ date: addDays(today, -5) });
    const pay = (extra: Record<string, unknown>) => api.create(owner, 'payments', { saleId: o._id, amount: 100, mode: 'UPI', ...extra });
    expect((await pay({ amount: 5001 })).status).toBe(409);
    expect((await pay({ amount: 0 })).status).toBe(400);
    expect((await pay({ amount: -10 })).status).toBe(400);
    expect((await pay({ date: addDays(today, 1) })).status).toBe(400);
    const early = await pay({ date: addDays(today, -9) });
    expect(early.status).toBe(400);
    expect(msg(early)).toMatch(/before the order date/);
    expect((await pay({ date: addDays(today, -5) })).status).toBe(201); // on the order's own day is fine
  });

  it('a wrong payment is cancelled and the order owes it again; cash and the customer balance follow', async () => {
    const cash = async () => ((await Account.findById('cash').lean()) as any)?.balance ?? 0;
    const c = (await cust()).json;
    const o = (await api.create(owner, 'sales', { customerId: c._id, stage: 'order', items: [line()] })).json;
    const before = await cash();
    const p = (await api.create(owner, 'payments', { saleId: o._id, amount: 2000, mode: 'Cash' })).json;
    expect(await cash()).toBe(before + 2000);
    expect(((await Sale.findById(o._id).lean()) as any)).toMatchObject({ paid: 2000, outstanding: 3000 });
    expect((await api.void(owner, 'payments', p._id, 'entered twice')).status).toBe(200);
    expect(await cash()).toBe(before);
    expect(((await Sale.findById(o._id).lean()) as any)).toMatchObject({ paid: 0, outstanding: 5000 });
    expect(((await Customer.findById(c._id).lean()) as any).outstanding).toBe(5000);
  });
});

describe('dispatch and gate pass', () => {
  it('a truck number looks like one, a driver mobile is a mobile, an e-way bill is 12 digits', async () => {
    const o = await order();
    const slip = (extra: Record<string, unknown>) => api.create(owner, 'dispatches', { saleId: o._id, truckNo: 'RJ06 GA 4521', items: [{ stockItemId: item._id, name: item.name, qty: 10 }], ...extra });
    const ok = await slip({ truckNo: ' rj06  ga 4521', driverMobile: '+91 98290 12345', driverName: 'Mohan Lal', transporter: 'Sharma Roadlines', eway: '123456789012' });
    expect(ok.status, msg(ok)).toBe(201);
    expect(ok.json).toMatchObject({ truckNo: 'RJ06 GA 4521', driverMobile: '9829012345', eway: '123456789012' });
    for (const bad of ['X1', 'TRUCK', '123456', '!!!!!!']) expect((await slip({ truckNo: bad })).status, bad).toBe(400);
    expect((await slip({ driverMobile: 'abcde' })).status).toBe(400);
    expect((await slip({ driverMobile: '12345' })).status).toBe(400);
    expect((await slip({ eway: '12345' })).status).toBe(400);
    expect((await slip({ eway: '12345678901A' })).status).toBe(400);
    expect((await slip({ driverName: '9999' })).status).toBe(400);
  });

  it('the loaded truck cannot weigh less than the empty one, and nothing is negative', async () => {
    const o = await order();
    const slip = (extra: Record<string, unknown>) => api.create(owner, 'dispatches', { saleId: o._id, truckNo: 'RJ06 GA 4522', items: [{ stockItemId: item._id, name: item.name, qty: 10 }], ...extra });
    const bad = await slip({ emptyWeight: 9000, loadedWeight: 4000 });
    expect(bad.status).toBe(400);
    expect(msg(bad)).toMatch(/less than the empty weight/);
    expect((await slip({ freight: -5 })).status).toBe(400);
    expect((await slip({ emptyWeight: -1 })).status).toBe(400);
    const ok = await slip({ emptyWeight: 9000, loadedWeight: 21000, freight: 4500 });
    expect(ok.json.netWeight).toBe(12000);
    expect((await api.patch(owner, 'dispatches', ok.json._id, { loadedWeight: 5000 })).status).toBe(400);
    expect((await api.patch(owner, 'dispatches', ok.json._id, { truckNo: 'nope' })).status).toBe(400);
    expect((await api.patch(owner, 'dispatches', ok.json._id, { loadedWeight: 22000 })).json.netWeight).toBe(13000);
  });
});

describe('suppliers use the same rules', () => {
  it('mobile, GST number, name and city', async () => {
    const mk = (extra: Record<string, unknown>) => api.create(owner, 'suppliers', { name: `Supplier ${++n}`, ...extra });
    const ok = await mk({ mobile: '+91 98290 77777', gstin: '08aaaaa0000a1z5', city: 'Kota' });
    expect(ok.status, msg(ok)).toBe(201);
    expect(ok.json).toMatchObject({ mobile: '9829077777', gstin: '08AAAAA0000A1Z5' });
    expect((await mk({})).status).toBe(201); // mobile and GST number are optional for a supplier
    expect((await mk({ mobile: 'abcdefghij' })).status).toBe(400);
    expect((await mk({ gstin: 'WRONG' })).status).toBe(400);
    expect((await mk({ city: 'Kota 123' })).status).toBe(400);
    expect((await api.create(owner, 'suppliers', { name: '=1+1' })).status).toBe(400);
  });
});
