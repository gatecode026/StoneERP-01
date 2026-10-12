import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

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
    fyStartMonth: { type: Number, default: 4, min: 1, max: 12 },
    units: { type: [String], default: ['sq ft', 'sq m', 'pieces', 'CFT', 'tonne', 'litres', 'kg', 'numbers'] },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true }
);

export type SettingsDoc = InferSchemaType<typeof settingsSchema>;
export const Settings: Model<SettingsDoc> = (mongoose.models.Settings as Model<SettingsDoc>) || mongoose.model<SettingsDoc>('Settings', settingsSchema);
