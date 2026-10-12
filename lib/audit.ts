/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { AuditLog } from './models';
import type { SessionUser } from './auth/session';

export type Actor = Pick<SessionUser, 'id' | 'name' | 'role' | 'preset' | 'empCode'>;

const SENSITIVE = new Set(['bankAccount', 'aadhaarNo', 'panNo', 'upi', 'docAadhaar', 'docPan', 'docPassbook', 'docLicense', 'passwordHash', 'photo', 'photos', 'billPhoto', 'selfie', 'rcPhoto', 'file', 'signature']);
const IGNORED = new Set(['updatedAt', 'createdAt', '_id', '__v', 'updatedById', 'updatedByName', 'createdById', 'createdByName']);

const trunc = (v: unknown): unknown => {
  if (typeof v === 'string') return v.length > 120 ? v.slice(0, 117) + '…' : v;
  if (v && typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 160 ? s.slice(0, 157) + '…' : v;
  }
  return v;
};

/** Field-by-field {from,to}; sensitive values are recorded as "[changed]" so the log itself never leaks them. */
export function diffObjects(prev: Record<string, any> | null, next: Record<string, any>): Record<string, { from?: unknown; to?: unknown }> {
  const out: Record<string, { from?: unknown; to?: unknown }> = {};
  for (const k of Object.keys(next)) {
    if (IGNORED.has(k)) continue;
    const a = JSON.stringify(prev?.[k] ?? null);
    const b = JSON.stringify(next[k] ?? null);
    if (a === b) continue;
    out[k] = SENSITIVE.has(k) ? { from: prev?.[k] ? '[hidden]' : undefined, to: '[changed]' } : { from: trunc(prev?.[k]), to: trunc(next[k]) };
  }
  return out;
}

export async function writeAudit(
  e: { resource: string; refId?: unknown; action: string; label?: string; changes?: unknown; requestId?: string },
  actor: Actor | null,
  session?: ClientSession
) {
  await AuditLog.create(
    [{
      model: e.resource, refId: e.refId ? String(e.refId) : '', action: e.action, label: e.label ?? '', changes: e.changes,
      byId: actor ? new Types.ObjectId(actor.id) : undefined, by: actor?.name ?? 'system', role: actor ? (actor.preset ?? actor.role) : 'system', requestId: e.requestId, at: new Date(),
    }],
    { session }
  );
}
