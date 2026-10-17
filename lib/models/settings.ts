import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const WEEK_OFF_RULES = ['none', 'all', '1st3rd5th', '2nd4th'] as const;
const weekOff = (def: (typeof WEEK_OFF_RULES)[number]) => ({ type: String, enum: WEEK_OFF_RULES, default: def });

/** A working shift. A shift whose end is not after its start crosses midnight (a night shift). */
const shiftSchema = new Schema(
  {
    id: { type: String, required: true, match: /^[a-z0-9_-]{1,20}$/ },
    name: { type: String, required: true, maxlength: 40 },
    start: { type: String, required: true, match: TIME },
    end: { type: String, required: true, match: TIME },
    breakMinutes: { type: Number, default: 60, min: 0, max: 240 }, // taken off the hours worked
    graceMinutes: { type: Number, default: 10, min: 0, max: 120 }, // arriving within this many minutes of the start is not late
    fullDayHours: { type: Number, default: 7, min: 1, max: 24 }, // worked at least this long = a full day
    halfDayHours: { type: Number, default: 4, min: 0.5, max: 24 }, // at least this long = a half day, less = absent
    otBufferMinutes: { type: Number, default: 30, min: 0, max: 240 }, // overtime counts only once they stay this long after the end
    otRoundMinutes: { type: Number, default: 30, min: 1, max: 120 }, // overtime is counted in blocks of this many minutes
  },
  { _id: false }
);
const holidaySchema = new Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    endDate: { type: String, default: '', match: /^(\d{4}-\d{2}-\d{2})?$/ }, // a festival of several days is one entry with an end date
    name: { type: String, required: true, maxlength: 60 },
  },
  { _id: false }
);

/** Company-wide settings. A single document with _id "main", edited only by the Owner (Settings screen, Phase 7). */
const settingsSchema = new Schema(
  {
    _id: { type: String, default: 'main' },
    company: {
      name: { type: String, default: 'Vipul Stone Suppliers' },
      brand: { type: String, default: 'RD Natural Stones, Mandsaur' },
      address: { type: String, default: 'Bijoliya, Bhilwara, Rajasthan - 311001' },
      gstin: { type: String, default: '' }, // must be set by the Owner before invoices are issued
      state: { type: String, default: 'Rajasthan' },
      stateCode: { type: String, default: '08' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      bankName: { type: String, default: '' },
      bankAccount: { type: String, default: '' },
      ifsc: { type: String, default: '' },
      logoKey: { type: String, default: '' },
    },
    schedule: {
      ownerReportTime: { type: String, default: '20:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
      reportReminderTime: { type: String, default: '19:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
      ownerReportEnabled: { type: Boolean, default: true },
    },
    limits: {
      expenseApproval: { type: Number, default: 5000, min: 0 }, // above this, non-owners need approval
      purchaseApproval: { type: Number, default: 25000, min: 0 },
      cashReceipt: { type: Number, default: 200000, min: 0 }, // Sec 269ST
      cashExpense: { type: Number, default: 10000, min: 0 }, // Sec 40A(3)
    },
    salary: {
      otMultiplier: { type: Number, default: 2, min: 1 },
      hoursPerDay: { type: Number, default: 8, min: 1, max: 24 },
      otHoursDefault: { type: Number, default: 2, min: 0 },
      pfRate: { type: Number, default: 0.12, min: 0, max: 1 },
      pfWageCap: { type: Number, default: 15000, min: 0 },
      esiRate: { type: Number, default: 0.0075, min: 0, max: 1 },
      esiGrossCap: { type: Number, default: 21000, min: 0 },
      payDay: { type: Number, default: 7, min: 1, max: 28 },
    },
    costRates: {
      labourPerHour: { type: Number, default: 80, min: 0 },
      powerPerUnit: { type: Number, default: 8, min: 0 },
      dieselPerLitre: { type: Number, default: 92, min: 0 },
    },
    workHours: {
      shifts: {
        type: [shiftSchema],
        default: () => [
          { id: 'day', name: 'Day shift', start: '09:00', end: '18:00', breakMinutes: 60, graceMinutes: 10, fullDayHours: 7, halfDayHours: 4, otBufferMinutes: 30, otRoundMinutes: 30 },
          { id: 'night', name: 'Night shift', start: '21:00', end: '06:00', breakMinutes: 60, graceMinutes: 10, fullDayHours: 7, halfDayHours: 4, otBufferMinutes: 30, otRoundMinutes: 30 },
        ],
      },
      defaultShiftId: { type: String, default: 'day' },
      // which weekdays are off: every one, or only the 1st/3rd/5th or the 2nd/4th of the month (for alternate Saturdays)
      weekOff: { sun: weekOff('all'), mon: weekOff('none'), tue: weekOff('none'), wed: weekOff('none'), thu: weekOff('none'), fri: weekOff('none'), sat: weekOff('none') },
      holidays: { type: [holidaySchema], default: [] },
      paidWeekOff: { type: Boolean, default: true }, // monthly-paid staff lose no pay on a weekly off or a holiday
      appPunching: { type: Boolean, default: true }, // Punch In / Out buttons in the app (for testing, until the biometric machine is connected)
      punchGapMinutes: { type: Number, default: 2, min: 0, max: 60 }, // a repeat punch this soon is ignored
      openDayAfterHours: { type: Number, default: 2, min: 0, max: 24 }, // an In with no Out this long after the shift ends is flagged for a fix
    },
    fyStartMonth: { type: Number, default: 4, min: 1, max: 12 },
    units: { type: [String], default: ['sq ft', 'sq m', 'pieces', 'CFT', 'tonne', 'litres', 'kg', 'numbers'] },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true }
);

export type SettingsDoc = InferSchemaType<typeof settingsSchema>;
export const Settings: Model<SettingsDoc> = (mongoose.models.Settings as Model<SettingsDoc>) || mongoose.model<SettingsDoc>('Settings', settingsSchema);
