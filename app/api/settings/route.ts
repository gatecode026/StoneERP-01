import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { jsonWithEtag } from '@/lib/api/http';
import { connect } from '@/lib/db';
import { Settings } from '@/lib/models/settings';
import { clearSettingsCache, getSettings } from '@/lib/settings';
import { diffObjects, writeAudit } from '@/lib/audit';
import { Employee } from '@/lib/models';
import { badRequest } from '@/lib/errors';
import { checkAccount, checkGstin } from '@/lib/validators';
import { GST_STATES } from '@/lib/gst';

export const dynamic = 'force-dynamic';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 20:00');
const text = (max = 200) => z.string().trim().max(max);
const money = z.number().min(0).max(1e10);

const shift = z.object({
  id: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,20}$/, 'Shift code: small letters, digits, - or _ (up to 20)'),
  name: text(40).min(1, 'Give the shift a name'), start: time, end: time,
  breakMinutes: z.number().int().min(0).max(240), graceMinutes: z.number().int().min(0).max(120),
  fullDayHours: z.number().min(1).max(24), halfDayHours: z.number().min(0.5).max(24),
  otBufferMinutes: z.number().int().min(0).max(240), otRoundMinutes: z.number().int().min(1).max(120),
}).strict().superRefine((v, ctx) => {
  if (v.start === v.end) ctx.addIssue({ code: 'custom', message: `${v.name}: start and end cannot be the same time` });
  if (v.halfDayHours > v.fullDayHours) ctx.addIssue({ code: 'custom', message: `${v.name}: half-day hours cannot be more than full-day hours` });
});
const weekOff = z.enum(['none', 'all', '1st3rd5th', '2nd4th']);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-09').refine((v) => !Number.isNaN(Date.parse(v)), 'Not a real date');
const workHours = z.object({
  shifts: z.array(shift).min(1, 'Keep at least one shift').max(10).superRefine((a, ctx) => { if (new Set(a.map((x) => x.id)).size !== a.length) ctx.addIssue({ code: 'custom', message: 'Two shifts have the same code' }); }),
  defaultShiftId: z.string().trim().toLowerCase(),
  weekOff: z.object({ sun: weekOff, mon: weekOff, tue: weekOff, wed: weekOff, thu: weekOff, fri: weekOff, sat: weekOff }).partial(),
  holidays: z.array(z.object({ date: isoDate, endDate: z.union([isoDate, z.literal('')]).optional(), name: text(60).min(1, 'Give the holiday a name') }).strict()
    .refine((h) => !h.endDate || h.endDate >= h.date, 'A holiday cannot end before it starts')).max(120),
  paidWeekOff: z.boolean(), appPunching: z.boolean(), punchGapMinutes: z.number().int().min(0).max(60), openDayAfterHours: z.number().min(0).max(24),
}).partial();

// every section is optional: the screen saves one section at a time
const body = z.object({
  company: z.object({
    name: text(120).min(1, 'Company name is required'), brand: text(120), address: text(300),
    gstin: z.string().trim().toUpperCase().superRefine((v, ctx) => { const m = checkGstin(v); if (m) ctx.addIssue({ code: 'custom', message: m }); }),
    state: text(60), stateCode: z.string().trim().regex(/^[0-9]{2}$/, 'State code is 2 digits, like 08'),
    phone: z.string().trim().max(20).refine((v) => v === '' || /^[0-9+()\s-]{8,20}$/.test(v), 'Phone can have digits, +, - and spaces only (8 to 20 characters)'), email: z.string().trim().max(120).refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Enter a valid email'),
    bankName: text(80), bankAccount: z.string().trim().refine((v) => v === '' || checkAccount(v) === '', 'Bank account number is 9 to 18 digits'), ifsc: z.string().trim().toUpperCase().refine((v) => v === '' || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), 'IFSC looks like SBIN0001234'),
  }).partial(),
  schedule: z.object({ ownerReportTime: time, reportReminderTime: time, ownerReportEnabled: z.boolean() }).partial(),
  limits: z.object({ expenseApproval: money, purchaseApproval: money, cashReceipt: money, cashExpense: money }).partial(),
  salary: z.object({
    otMultiplier: z.number().min(1).max(5), hoursPerDay: z.number().min(1).max(24), otHoursDefault: z.number().min(0).max(24),
    pfRate: z.number().min(0).max(1), pfWageCap: money, esiRate: z.number().min(0).max(1), esiGrossCap: money, payDay: z.number().int().min(1).max(28),
  }).partial(),
  costRates: z.object({ labourPerHour: money, powerPerUnit: money, dieselPerLitre: money }).partial(),
  workHours,
  fyStartMonth: z.number().int().min(1).max(12),
}).partial().strict();

// { limits: { cashExpense: 1 } } -> { 'limits.cashExpense': 1 }, so the audit trail names each setting that changed
const flat = (o: object): Record<string, unknown> => Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).map(([k2, v2]) => [`${k}.${k2}`, v2]) : [[k, v]])));

/** Company-wide settings — only people with the "settings" right (the Owner) can open or change them. */
export const GET = withAuth('settings', 'view', async (auth) => jsonWithEtag(auth.req, await getSettings()));

export const PUT = withAuth('settings', 'edit', async (auth) => {
  const input = await auth.json(body);
  const before = await getSettings();
  if (input.company) {
    // the GST number, the state and the state code must tell the same story: they decide CGST + SGST or IGST on every bill
    const c = { ...before.company, ...input.company };
    if (c.gstin) {
      const code = c.gstin.slice(0, 2);
      if (c.stateCode !== code) throw badRequest(`The state code ${c.stateCode} does not match the GST number, which starts with ${code} (${GST_STATES[code]})`);
    }
    if (GST_STATES[c.stateCode] && c.state && GST_STATES[c.stateCode].toLowerCase().replace(/[^a-z]/g, '') !== c.state.toLowerCase().replace(/[^a-z]/g, '')) throw badRequest(`State code ${c.stateCode} is ${GST_STATES[c.stateCode]}, not ${c.state}`);
  }
  const wh = input.workHours;
  if (wh) {
    const shifts = wh.shifts ?? before.workHours.shifts;
    const ids = new Set(shifts.map((x) => x.id));
    const def = wh.defaultShiftId ?? before.workHours.defaultShiftId;
    if (!ids.has(def)) throw badRequest('Choose one of the shifts as the default shift');
    if (wh.shifts) {
      const removed = before.workHours.shifts.map((x) => x.id).filter((id) => !ids.has(id));
      if (removed.length) {
        const used = await Employee.countDocuments({ shiftId: { $in: removed }, isVoid: false });
        if (used) throw badRequest(`${used} employee${used > 1 ? 's' : ''} still work${used > 1 ? '' : 's'} on a shift you removed. Change their shift first.`);
      }
    }
  }
  const $set: Record<string, unknown> = { updatedBy: auth.user.name };
  for (const [section, value] of Object.entries(input)) {
    if (section === 'fyStartMonth') { $set.fyStartMonth = value; continue; }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) $set[`${section}.${k}`] = v;
  }
  await connect();
  await Settings.updateOne({ _id: 'main' }, { $set }, { upsert: true });
  clearSettingsCache();
  const after = await getSettings();
  const changes = diffObjects(flat(before), flat(after));
  if (Object.keys(changes).length) {
    await writeAudit({ resource: 'settings', refId: 'main', action: 'update', label: 'Company settings', changes, requestId: auth.requestId },
      { id: auth.user.id, name: auth.user.name, role: auth.user.role, preset: auth.user.preset, empCode: auth.user.empCode });
  }
  return after;
});
