/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ClientSession } from 'mongoose';
import { Settings } from './models/settings';
import { connect } from './db';

export type Shift = { id: string; name: string; start: string; end: string; breakMinutes: number; graceMinutes: number; fullDayHours: number; halfDayHours: number; otBufferMinutes: number; otRoundMinutes: number };
export type WeekOffRule = 'none' | 'all' | '1st3rd5th' | '2nd4th';
export type WorkHours = {
  shifts: Shift[]; defaultShiftId: string;
  weekOff: Record<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat', WeekOffRule>;
  holidays: { date: string; endDate?: string; name: string }[];
  paidWeekOff: boolean; appPunching: boolean; punchGapMinutes: number; openDayAfterHours: number;
};

export type AppSettings = {
  company: { name: string; brand: string; address: string; gstin: string; state: string; stateCode: string; phone: string; email: string; bankName: string; bankAccount: string; ifsc: string; logoKey: string };
  schedule: { ownerReportTime: string; reportReminderTime: string; ownerReportEnabled: boolean };
  limits: { expenseApproval: number; purchaseApproval: number; cashReceipt: number; cashExpense: number };
  salary: { otMultiplier: number; hoursPerDay: number; otHoursDefault: number; pfRate: number; pfWageCap: number; esiRate: number; esiGrossCap: number; payDay: number };
  costRates: { labourPerHour: number; powerPerUnit: number; dieselPerLitre: number };
  workHours: WorkHours;
  fyStartMonth: number;
  units: string[];
};

const TTL = 20_000;
function deepFill(stored: any, defaults: any): any {
  if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
    const out: any = { ...defaults };
    for (const k of Object.keys(stored ?? {})) out[k] = k in defaults ? deepFill(stored[k], defaults[k]) : stored[k];
    return out;
  }
  return stored === undefined || stored === null ? defaults : stored;
}
const g = globalThis as unknown as { _vssSettings?: { at: number; value: AppSettings }; _vssSettingsLoad?: Promise<AppSettings>; _vssSettingsGen?: number };
// a stored document written by an older release may lack newer settings: fill every gap from the schema defaults
const fill = (doc: any) => deepFill(JSON.parse(JSON.stringify(doc)), JSON.parse(JSON.stringify(new Settings({ _id: 'main' }).toObject()))) as AppSettings;

async function loadSettings(): Promise<AppSettings> {
  await connect();
  // a plain READ on every refresh; the document is only written (created with its defaults) the very first time it is missing
  let doc: any = await Settings.findOne({ _id: 'main' }).lean();
  if (!doc) doc = await Settings.findOneAndUpdate({ _id: 'main' }, { $setOnInsert: { _id: 'main' } }, { upsert: true, returnDocument: 'after', lean: true, setDefaultsOnInsert: true });
  return fill(doc);
}

/** Cached read of the single Settings document (created with defaults on first use). Concurrent callers share one database read. */
export async function getSettings(session?: ClientSession): Promise<AppSettings> {
  if (session) {
    // inside a transaction: read through that session so the caller sees its own writes (never cached)
    await connect();
    return fill(await Settings.findOneAndUpdate({ _id: 'main' }, { $setOnInsert: { _id: 'main' } }, { upsert: true, returnDocument: 'after', session, lean: true, setDefaultsOnInsert: true }));
  }
  const c = g._vssSettings;
  if (c && Date.now() - c.at < TTL) return c.value;
  if (g._vssSettingsLoad) return g._vssSettingsLoad;
  const gen = g._vssSettingsGen ?? 0;
  const p = loadSettings()
    .then((value) => { if ((g._vssSettingsGen ?? 0) === gen) g._vssSettings = { at: Date.now(), value }; return value; }) // not if settings were saved while this read was in flight
    .finally(() => { if (g._vssSettingsLoad === p) g._vssSettingsLoad = undefined; });
  g._vssSettingsLoad = p;
  return p;
}
export function clearSettingsCache() {
  g._vssSettingsGen = (g._vssSettingsGen ?? 0) + 1;
  g._vssSettings = undefined;
  g._vssSettingsLoad = undefined;
}
