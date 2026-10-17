/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, makeUser, resetCaches, type Who } from '../api';
import { Employee } from '@/lib/models';
import { decryptField } from '@/lib/crypto';
import { addDays, todayIST } from '@/lib/time';

let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who;
const good = { job: 'Helper', payType: 'daily', rate: 500 };
let n = 0;
const make = (extra: Record<string, unknown>) => api.create(owner, 'employees', { ...good, name: `Person ${n++}`, ...extra });
const message = (r: any) => JSON.stringify(r.json?.error ?? {}); // the field and the reason travel in error.details

beforeAll(async () => { db = await useTestDb('empvalid'); resetCaches(); owner = await makeUser('owner'); });
afterAll(async () => { await db.close(); });

describe('employee form rules are enforced by the server', () => {
  it.each([
    ['aadhaarNo', '234123412347', /Aadhaar/],
    ['aadhaarNo', '123412341234', /Aadhaar/],
    ['aadhaarNo', '2341234', /Aadhaar/],
    ['panNo', 'ABCDE1234F', /PAN/],
    ['panNo', 'ABC12', /PAN/],
    ['bankAccount', '1234', /Account number/],
    ['bankAccount', '111111111111', /account number/i],
    ['ifsc', 'SBIN1001234', /IFSC/],
    ['upi', 'not-a-upi', /UPI/],
    ['pfNo', '123', /PF/],
    ['esiNo', '12345', /ESI/],
    ['mobile', '1234567890', /mobile/i],
    ['emergencyMobile', '98', /mobile/i],
    ['name', 'R', /Name/],
    ['fatherName', '@@', /Name/],
    ['rate', 0, /Pay rate/],
    ['rate', -5, /Pay rate/],
  ])('refuses a bad %s (%s)', async (field, value, text) => {
    const r = await make({ mobile: '9829011111', [field as string]: value, _confirmed: true });
    expect(r.status, JSON.stringify(r.json)).toBe(400);
    expect(message(r)).toMatch(text as RegExp);
  });

  it('tidies and keeps good values (spaces, dashes, capitals), and stores the secret ones encrypted', async () => {
    const r = await make({ aadhaarNo: '2341 2341 2346', panNo: ' abcpe1234f ', bankAccount: '1234 5678 9012', ifsc: 'sbin0001234', upi: ' Ramesh.M@OkSBI ', pfNo: '123456789012', pfApplicable: true, esiNo: '1234567890', esiApplicable: true, mobile: '+91 98290 22222', emergencyMobile: '9829033333', emergencyName: 'Mohan Meena', _confirmed: true });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const raw: any = await Employee.findById(r.json._id).lean();
    expect(decryptField(raw.aadhaarNo)).toBe('234123412346');
    expect(decryptField(raw.panNo)).toBe('ABCPE1234F');
    expect(decryptField(raw.bankAccount)).toBe('123456789012');
    expect(raw).toMatchObject({ ifsc: 'SBIN0001234', upi: 'ramesh.m@oksbi', pfNo: '123456789012', esiNo: '1234567890', mobile: '9829022222', emergencyMobile: '9829033333' });
  });

  it('an edit that touches one field is not blocked by an old value in another', async () => {
    const r = await make({ mobile: '9829044444', _confirmed: true });
    await Employee.updateOne({ _id: r.json._id }, { $set: { upi: 'old style upi', joiningDate: '1970-01-01' } }); // data from before the rules
    expect((await api.patch(owner, 'employees', r.json._id, { job: 'Polisher' })).status).toBe(200);
    expect((await api.patch(owner, 'employees', r.json._id, { upi: 'still bad' })).status).toBe(400);
    expect((await api.patch(owner, 'employees', r.json._id, { upi: 'good.one@ybl' })).status).toBe(200);
  });

  it('the emergency contact must differ from the employee, and dates must make sense', async () => {
    expect(message(await make({ mobile: '9829055555', emergencyMobile: '9829055555', _confirmed: true }))).toMatch(/different number/);
    expect(message(await make({ joiningDate: addDays(todayIST(), 90), mobile: '9829055556', _confirmed: true }))).toMatch(/60 days/);
    expect(message(await make({ joiningDate: '2025-05-01', status: 'left', leavingDate: '2025-04-01', mobile: '9829055557', _confirmed: true }))).toMatch(/Leaving date/);
  });
});

describe('employee code is numbered by the server', () => {
  it('EMP-0046, EMP-0047 … in order, with no repeats, even for two at once', async () => {
    const a: any = await make({ mobile: '9829066661', _confirmed: true });
    const b: any = await make({ mobile: '9829066662', _confirmed: true });
    const [c, d]: any[] = await Promise.all([make({ mobile: '9829066663', _confirmed: true }), make({ mobile: '9829066664', _confirmed: true })]);
    const codes = [a, b, c, d].map((x) => x.json.empCode);
    expect(codes.every((x) => /^EMP-\d{4}$/.test(x))).toBe(true);
    expect(new Set(codes).size).toBe(4);
    const num = (x: string) => Number(x.slice(4));
    expect(num(b.json.empCode)).toBe(num(a.json.empCode) + 1);
  });
  it('a code that is already taken is skipped, never reused', async () => {
    const next: any = await make({ mobile: '9829066670', _confirmed: true });
    const n1 = Number(next.json.empCode.slice(4)) + 1;
    await make({ empCode: `EMP-${String(n1).padStart(4, '0')}`, mobile: '9829066671', _confirmed: true }); // typed by hand (an Excel import can do this)
    const after: any = await make({ mobile: '9829066672', _confirmed: true });
    expect(after.json.empCode).toBe(`EMP-${String(n1 + 1).padStart(4, '0')}`);
  });
  it('keeps older codes as they are, and refuses a repeat', async () => {
    const r: any = await make({ empCode: 'E045', mobile: '9829066680', _confirmed: true });
    expect(r.json.empCode).toBe('E045');
    expect((await make({ empCode: 'E045', mobile: '9829066681', _confirmed: true })).status).toBe(409);
  });
});

describe('a mobile number that is already someone’s sign-in', () => {
  const login = { enabled: true, role: 'worker', password: 'Start-Pass-123' };
  it('is refused straight away (no "save anyway?" first) and nothing is saved', async () => {
    const first: any = await make({ mobile: '9829077001', login });
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    const before = await Employee.countDocuments({});
    const again: any = await make({ mobile: '9829077001', login });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('CONFLICT');
    expect(again.json.error.message).toMatch(/already signs in with this mobile number/);
    expect(await Employee.countDocuments({})).toBe(before);
  });
  it('a plain profile on the same number still gets the confirmation question, then saves once', async () => {
    const ask: any = await make({ mobile: '9829077001' });
    expect(ask.status).toBe(409);
    expect(ask.json.error.code).toBe('CONFIRM_REQUIRED');
    const before = await Employee.countDocuments({});
    expect((await make({ mobile: '9829077001', _confirmed: true })).status).toBe(201);
    expect(await Employee.countDocuments({})).toBe(before + 1);
  });
  it('giving an existing person a sign-in on a number that is taken is refused the same way', async () => {
    const plain: any = await make({ mobile: '9829077002' });
    const r: any = await api.patch(owner, 'employees', plain.json._id, { mobile: '9829077001', login });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/already signs in/);
    expect(((await Employee.findById(plain.json._id).lean()) as any).mobile).toBe('9829077002');
  });
});
