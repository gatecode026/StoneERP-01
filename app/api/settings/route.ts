import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { jsonWithEtag } from '@/lib/api/http';
import { connect } from '@/lib/db';
import { Settings } from '@/lib/models/settings';
import { clearSettingsCache, getSettings } from '@/lib/settings';
import { diffObjects, writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 20:00');
const text = (max = 200) => z.string().trim().max(max);
const money = z.number().min(0).max(1e10);

// every section is optional: the screen saves one section at a time
const body = z.object({
  company: z.object({
    name: text(120).min(1, 'Company name is required'), brand: text(120), address: text(300),
    gstin: z.string().trim().toUpperCase().refine((v) => v === '' || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v), 'GST number must be 15 characters, like 08ABCDE1234F1Z5'),
    state: text(60), stateCode: z.string().trim().regex(/^[0-9]{2}$/, 'State code is 2 digits, like 08'),
    phone: text(20), email: z.string().trim().max(120).refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Enter a valid email'),
    bankName: text(80), bankAccount: text(30), ifsc: z.string().trim().toUpperCase().refine((v) => v === '' || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), 'IFSC looks like SBIN0001234'),
  }).partial(),
  schedule: z.object({ ownerReportTime: time, reportReminderTime: time, ownerReportEnabled: z.boolean() }).partial(),
  limits: z.object({ expenseApproval: money, purchaseApproval: money, cashReceipt: money, cashExpense: money }).partial(),
  salary: z.object({
    otMultiplier: z.number().min(1).max(5), hoursPerDay: z.number().min(1).max(24), otHoursDefault: z.number().min(0).max(24),
    pfRate: z.number().min(0).max(1), pfWageCap: money, esiRate: z.number().min(0).max(1), esiGrossCap: money, payDay: z.number().int().min(1).max(28),
  }).partial(),
  costRates: z.object({ labourPerHour: money, powerPerUnit: money, dieselPerLitre: money }).partial(),
  fyStartMonth: z.number().int().min(1).max(12),
}).partial().strict();

// { limits: { cashExpense: 1 } } -> { 'limits.cashExpense': 1 }, so the audit trail names each setting that changed
const flat = (o: object): Record<string, unknown> => Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).map(([k2, v2]) => [`${k}.${k2}`, v2]) : [[k, v]])));

/** Company-wide settings — only people with the "settings" right (the Owner) can open or change them. */
export const GET = withAuth('settings', 'view', async (auth) => jsonWithEtag(auth.req, await getSettings()));

export const PUT = withAuth('settings', 'edit', async (auth) => {
  const input = await auth.json(body);
  const before = await getSettings();
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
