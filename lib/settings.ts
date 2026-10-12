/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ClientSession } from 'mongoose';
import { Settings } from './models/settings';
import { connect } from './db';

export type AppSettings = {
  company: { name: string; brand: string; address: string; gstin: string; state: string; stateCode: string; phone: string; email: string; bankName: string; bankAccount: string; ifsc: string; logoKey: string };
  schedule: { ownerReportTime: string; reportReminderTime: string; ownerReportEnabled: boolean };
  limits: { expenseApproval: number; purchaseApproval: number; cashReceipt: number; cashExpense: number };
  salary: { otMultiplier: number; hoursPerDay: number; otHoursDefault: number; pfRate: number; pfWageCap: number; esiRate: number; esiGrossCap: number; payDay: number };
  costRates: { labourPerHour: number; powerPerUnit: number; dieselPerLitre: number };
  fyStartMonth: number;
  units: string[];
};

const TTL = 20_000;
const g = globalThis as unknown as { _vssSettings?: { at: number; value: AppSettings } };

/** Cached read of the single Settings document (created with defaults on first use). */
export async function getSettings(session?: ClientSession): Promise<AppSettings> {
  const c = g._vssSettings;
  if (!session && c && Date.now() - c.at < TTL) return c.value;
  await connect();
  const doc: any = await Settings.findOneAndUpdate({ _id: 'main' }, { $setOnInsert: { _id: 'main' } }, { upsert: true, returnDocument: 'after', session, lean: true, setDefaultsOnInsert: true });
  const value = JSON.parse(JSON.stringify(doc)) as AppSettings;
  if (!session) g._vssSettings = { at: Date.now(), value };
  return value;
}
export function clearSettingsCache() {
  g._vssSettings = undefined;
}
