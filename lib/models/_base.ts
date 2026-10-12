/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { Schema, type Model, type SchemaDefinition, type IndexDefinition, type IndexOptions } from 'mongoose';

export const S = String;
export const N = Number;
export const B = Boolean;
export const OID = Schema.Types.ObjectId;
export type AnyModel = Model<any>;

/** Strict date strings: business dates are 'YYYY-MM-DD' (IST), months 'YYYY-MM'. */
export const dateStr = (extra: Record<string, unknown> = {}) => ({ type: String, match: /^\d{4}-\d{2}-\d{2}$/, ...extra });
export const monthStr = (extra: Record<string, unknown> = {}) => ({ type: String, match: /^\d{4}-(0[1-9]|1[0-2])$/, ...extra });
export const money = (extra: Record<string, unknown> = {}) => ({ type: Number, min: 0, ...extra });

/**
 * Fields every business record carries. `isVoid` (soft-delete) is deliberately separate from each model's
 * own domain `status` (approved / pending / open / closed …).
 */
export const baseFields: SchemaDefinition = {
  createdById: { type: OID, index: true },
  createdByName: { type: S },
  updatedById: { type: OID },
  updatedByName: { type: S },
  isVoid: { type: B, default: false },
  voidedAt: { type: Date },
  voidedById: { type: OID },
  voidedByName: { type: S },
  voidReason: { type: S, maxlength: 500 },
};

export type ModelOpts = {
  indexes?: [IndexDefinition, IndexOptions?][];
  /** audit-style collections that are not soft-voidable */
  noBase?: boolean;
};

/** Create (or reuse) a strict model. Unknown fields are dropped; `strict:'throw'` would reject, so we validate in Zod first. */
export function defineModel(name: string, fields: SchemaDefinition, opts: ModelOpts = {}): AnyModel {
  if (mongoose.models[name]) return mongoose.models[name] as AnyModel;
  const schema = new Schema({ ...(opts.noBase ? {} : baseFields), ...fields }, { timestamps: true, strict: true, versionKey: false, minimize: false });
  for (const [def, o] of opts.indexes ?? []) schema.index(def, o);
  return mongoose.model(name, schema) as AnyModel;
}

/** Partial unique index helper: unique only among non-void records. */
export const liveUnique = (extra: Record<string, unknown> = {}): IndexOptions => ({ unique: true, partialFilterExpression: { isVoid: false, ...extra } });
