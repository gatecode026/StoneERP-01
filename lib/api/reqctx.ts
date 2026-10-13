/* eslint-disable @typescript-eslint/no-explicit-any */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Schema } from 'mongoose';
import { logger } from '../logger';

/**
 * Per-request bookkeeping: how many database round trips a request made and how long they took. Every schema registers
 * `trackQueries`, so the request log can say "23 ms, 4 queries, 11 ms in the database", and any single query slower than
 * SLOW_QUERY_MS is logged with its collection, operation and the SHAPE of its filter (keys only, never values).
 */
export type ReqStore = { requestId: string; queries: number; dbMs: number; slow: number };
const als = new AsyncLocalStorage<ReqStore>();

export const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS ?? 200);
export const runWithStore = <T>(requestId: string, fn: () => Promise<T>): Promise<T> => als.run({ requestId, queries: 0, dbMs: 0, slow: 0 }, fn);
export const currentStore = () => als.getStore();

const shape = (f: unknown, depth = 0): unknown => {
  if (!f || typeof f !== 'object' || depth > 3) return typeof f === 'object' ? '{…}' : typeof f;
  if (Array.isArray(f)) return f.slice(0, 4).map((x) => shape(x, depth + 1));
  return Object.fromEntries(Object.keys(f as object).slice(0, 12).map((k) => [k, shape((f as any)[k], depth + 1)]));
};

function record(collection: string, op: string, ms: number, filter?: unknown) {
  const s = als.getStore();
  if (s) { s.queries++; s.dbMs += ms; }
  if (ms >= SLOW_QUERY_MS) {
    if (s) s.slow++;
    logger.warn({ requestId: s?.requestId, collection, op, ms: Math.round(ms), filter: shape(filter) }, 'slow query');
  }
}

const QUERY_OPS = ['find', 'findOne', 'countDocuments', 'estimatedDocumentCount', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'distinct'] as const;

/** Mongoose plugin: times every query, aggregate, save and bulk write made through a model. */
export function trackQueries(schema: Schema) {
  schema.pre(QUERY_OPS as any, function (this: any) { this._t0 = performance.now(); });
  schema.post(QUERY_OPS as any, function (this: any) {
    if (this._t0 != null) record(this.mongooseCollection?.name ?? this.model?.collection?.name ?? '?', this.op, performance.now() - this._t0, this.getFilter?.());
  });
  schema.pre('aggregate', function (this: any) { this._t0 = performance.now(); });
  schema.post('aggregate', function (this: any) {
    if (this._t0 != null) record(this._model?.collection?.name ?? '?', 'aggregate', performance.now() - this._t0, this.pipeline?.()[0]);
  });
  schema.pre('save', function (this: any) { this._t0 = performance.now(); });
  schema.post('save', function (this: any) {
    if (this._t0 != null) record(this.constructor?.collection?.name ?? '?', 'save', performance.now() - this._t0);
  });
  schema.pre('insertMany', function (this: any) { this._t0 = performance.now(); });
  schema.post('insertMany', function (this: any) {
    record(this.collection?.name ?? '?', 'insertMany', performance.now() - (this._t0 ?? performance.now()));
  });
  schema.pre('bulkWrite', function (this: any) { this._t0 = performance.now(); });
  schema.post('bulkWrite', function (this: any) {
    record(this.collection?.name ?? '?', 'bulkWrite', performance.now() - (this._t0 ?? performance.now()));
  });
}
