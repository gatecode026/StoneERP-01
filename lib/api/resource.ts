/* eslint-disable @typescript-eslint/no-explicit-any */
import { z, type ZodType } from 'zod';
import { NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { withTxn } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { diffObjects, writeAudit } from '../audit';
import { assertWritable, hiddenFields, projectDoc, scopedIdFilter, scopeFilter } from '../perm/engine';
import type { Resource } from '../perm/resources';
import type { AnyModel } from '../models/_base';
import { buildFilter, encodeCursor, parseListQuery, type ListSpec } from './query';
import type { AuthCtx } from './withAuth';
import { oid, type SvcCtx } from '../services/core';
import { ingestPhotos } from '../storage/files';

/**
 * A resource = a model + the contract for talking to it over HTTP. Business rules live in `lifecycle`
 * (all of it runs inside ONE database transaction together with the audit entry).
 */
export type CreateResult = { doc: any; action?: string; changes?: unknown; status?: number };
export type Lifecycle = {
  /** Take over creation completely (several documents, upserts…). Runs inside the transaction; the result is scope-checked and audited. */
  create?(ctx: SvcCtx, input: any, auth: AuthCtx): Promise<CreateResult>;
  /** Return the document to insert (derive names, numbers, status; may throw). Receives the validated body. */
  prepareCreate?(ctx: SvcCtx, input: any, auth: AuthCtx): Promise<Record<string, any>> | Record<string, any>;
  afterCreate?(ctx: SvcCtx, doc: any): Promise<void>;
  /** Return the final $set (derive/validate; may throw). */
  prepareUpdate?(ctx: SvcCtx, prev: any, patch: Record<string, any>, auth: AuthCtx): Promise<Record<string, any>> | Record<string, any>;
  afterUpdate?(ctx: SvcCtx, doc: any, prev: any): Promise<void>;
  /** Guard + reverse side effects before a record is cancelled; throw to block the cancel. */
  beforeVoid?(ctx: SvcCtx, doc: any, reason: string): Promise<void>;
  /** The record can never be cancelled through the API (use a reversing business action instead). */
  noVoid?: string;
};

export type ResourceDef = ListSpec & {
  key: Resource;
  model: AnyModel;
  label(doc: any): string;
  create?: ZodType;
  update?: ZodType;
  /** keys a client may never send (workflow state, money fields, numbers…) → 400 instead of silently ignored */
  serverOnly?: readonly string[];
  lifecycle?: Lifecycle;
};

const looseBody = z.record(z.string(), z.any());

function stripMeta(raw: Record<string, any>) {
  const { _confirmed, ...rest } = raw;
  return { body: rest, confirmed: _confirmed === true };
}

function rejectServerOnly(def: ResourceDef, body: Record<string, any>) {
  const bad = (def.serverOnly ?? []).filter((k) => k in body);
  if (bad.length) throw badRequest(`These fields are set by the server and cannot be sent: ${bad.join(', ')}`);
}

function parseWith(schema: ZodType | undefined, body: Record<string, any>, what: string) {
  if (!schema) throw forbidden(`${what} is not available for this resource`);
  return schema.parse(body) as Record<string, any>;
}

// ------------------------------------------------------------------ list
export async function listResource(auth: AuthCtx, def: ResourceDef) {
  const hidden = hiddenFields(auth.perm, def.key);
  const lq = parseListQuery(auth.query, def, { hidden });
  const scope = await auth.filter('view');
  const filter = buildFilter(lq, def, scope);
  const projection = Object.fromEntries(lq.select.map((f) => [f, 1]));
  projection._id = 1;
  const baseFilter = buildFilter({ ...lq, cursor: undefined }, def, scope);
  const rows: any[] = await def.model
    .find(filter, projection)
    .sort({ [lq.sortField]: lq.sortDir, _id: lq.sortDir })
    .limit(lq.limit + 1)
    .lean();
  const hasMore = rows.length > lq.limit;
  if (hasMore) rows.pop();
  const last = rows[rows.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(lq.sortField === '_id' ? null : last[lq.sortField], last._id) : null;
  const out: Record<string, unknown> = { data: rows.map((r) => projectDoc(auth.perm, def.key, r)), nextCursor };
  if (lq.count) out.total = await def.model.countDocuments(baseFilter, { limit: 10001 });
  return NextResponse.json(out);
}

// ------------------------------------------------------------------ get
export async function getResource(auth: AuthCtx, def: ResourceDef, id: string) {
  const f = await scopedIdFilter(auth.user, auth.perm, def.key, 'view', id);
  const doc = f ? await def.model.findOne(f).lean() : null;
  if (!doc) throw notFound(); // out-of-scope rows look exactly like missing rows (no IDOR hint)
  return NextResponse.json(projectDoc(auth.perm, def.key, doc as any));
}

// ------------------------------------------------------------------ create
export async function createResource(auth: AuthCtx, def: ResourceDef) {
  const raw = await auth.json(looseBody);
  const { body, confirmed } = stripMeta(raw);
  rejectServerOnly(def, body);
  const input = parseWith(def.create, body, 'Creating');
  assertWritable(auth.perm, def.key, Object.keys(input));
  await ingestPhotos(input, def.key, auth.user.id); // inline photos become stored files; the database keeps only keys
  const ctx = await auth.svc({ confirmed });
  const { doc: created, status } = await withTxn(async (session) => {
    const c: SvcCtx = { ...ctx, session };
    let res: CreateResult;
    if (def.lifecycle?.create) {
      res = await def.lifecycle.create(c, input, auth);
    } else {
      const doc = def.lifecycle?.prepareCreate ? await def.lifecycle.prepareCreate(c, input, auth) : input;
      const stampDoc = { ...doc, createdById: oid(auth.user.id), createdByName: auth.user.name, updatedById: oid(auth.user.id), updatedByName: auth.user.name };
      const [inserted] = await def.model.create([stampDoc], { session });
      res = { doc: inserted.toObject() };
      if (def.lifecycle?.afterCreate) await def.lifecycle.afterCreate(c, res.doc);
    }
    await assertInScope(auth, def, res.doc._id, 'create', session);
    await writeAudit({ resource: def.key, refId: res.doc._id, action: res.action ?? 'create', label: def.label(res.doc), changes: res.changes, requestId: auth.requestId }, c.actor, session);
    return { doc: res.doc, status: res.status ?? 201 };
  });
  return NextResponse.json(projectDoc(auth.perm, def.key, created), { status });
}

/** Inside the transaction: the saved row must be one the user is allowed to have created/edited (own/team scope). */
async function assertInScope(auth: AuthCtx, def: ResourceDef, id: unknown, action: 'create' | 'edit', session: any) {
  const scope = auth.perm.scope(def.key, action);
  if (scope === 'all') return;
  const sf = await scopeFilter(auth.user, auth.perm, def.key, action);
  const ok = await def.model.exists({ $and: [{ _id: id }, sf] }).session(session ?? null);
  if (!ok) throw forbidden('You can only add or change your own records');
}

// ------------------------------------------------------------------ update
export async function updateResource(auth: AuthCtx, def: ResourceDef, id: string) {
  const raw = await auth.json(looseBody);
  const { body, confirmed } = stripMeta(raw);
  rejectServerOnly(def, body);
  const patch = parseWith(def.update, body, 'Editing');
  const keys = Object.keys(patch);
  if (!keys.length) throw badRequest('Nothing to change');
  await ingestPhotos(patch, def.key, auth.user.id);
  const f = await scopedIdFilter(auth.user, auth.perm, def.key, 'edit', id);
  if (!f) throw notFound();
  const ctx = await auth.svc({ confirmed });
  const result = await withTxn(async (session) => {
    const c: SvcCtx = { ...ctx, session };
    const prev: any = await def.model.findOne(f).session(session ?? null).lean();
    if (!prev) throw notFound();
    if (prev.isVoid) throw conflict('This record has been cancelled and can no longer be changed');
    // only fields whose value actually changes count (a form re-sending an unchanged pay rate must not trip the Manager's read-only rate)
    const changed = keys.filter((k) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(patch[k] ?? null));
    if (!changed.length) return prev;
    assertWritable(auth.perm, def.key, changed);
    for (const k of keys) if (!changed.includes(k)) delete patch[k];
    const set = def.lifecycle?.prepareUpdate ? await def.lifecycle.prepareUpdate(c, prev, { ...patch }, auth) : patch;
    const doc: any = await def.model
      .findOneAndUpdate({ _id: prev._id }, { $set: { ...set, updatedById: oid(auth.user.id), updatedByName: auth.user.name } }, { returnDocument: 'after', session, runValidators: true })
      .lean();
    await assertInScope(auth, def, doc._id, 'edit', session);
    if (def.lifecycle?.afterUpdate) await def.lifecycle.afterUpdate(c, doc, prev);
    const changes = diffObjects(prev, set);
    await writeAudit({ resource: def.key, refId: doc._id, action: 'update', label: def.label(prev), changes, requestId: auth.requestId }, c.actor, session);
    return doc;
  });
  return NextResponse.json(projectDoc(auth.perm, def.key, result));
}

// ------------------------------------------------------------------ void (cancel — never delete)
const voidBody = z.object({ reason: z.string().trim().max(500).optional() }).optional();

export async function voidResource(auth: AuthCtx, def: ResourceDef, id: string) {
  const parsed = voidBody.parse(await auth.json(z.record(z.string(), z.any()).default({})));
  const reason = parsed?.reason ?? '';
  if (def.lifecycle?.noVoid) throw conflict(def.lifecycle.noVoid);
  const f = await scopedIdFilter(auth.user, auth.perm, def.key, 'void', id);
  if (!f) throw notFound();
  const ctx = await auth.svc();
  const result = await withTxn(async (session) => {
    const c: SvcCtx = { ...ctx, session };
    const doc: any = await def.model.findOne(f).session(session ?? null).lean();
    if (!doc) throw notFound();
    if (doc.isVoid) throw conflict('Already cancelled');
    if (def.lifecycle?.beforeVoid) await def.lifecycle.beforeVoid(c, doc, reason);
    const upd: any = await def.model
      .findOneAndUpdate({ _id: doc._id, isVoid: false }, { $set: { isVoid: true, voidedAt: new Date(), voidedById: oid(auth.user.id), voidedByName: auth.user.name, voidReason: reason, updatedById: oid(auth.user.id), updatedByName: auth.user.name } }, { returnDocument: 'after', session })
      .lean();
    if (!upd) throw conflict('Already cancelled');
    await writeAudit({ resource: def.key, refId: doc._id, action: 'void', label: def.label(doc), changes: { isVoid: { from: false, to: true }, reason: { to: reason } }, requestId: auth.requestId }, c.actor, session);
    return upd;
  });
  return NextResponse.json(projectDoc(auth.perm, def.key, result));
}

export const isId = (id: string) => Types.ObjectId.isValid(id);
