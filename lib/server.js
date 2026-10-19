// LEGACY request helpers used by the pre-permission-engine routes (lib/crud.js, app/api/actions, …).
// Phase 2 replaces every caller with lib/api/withAuth. Authentication here is already the real server-side session.
import { NextResponse } from 'next/server';
import { connect } from './db';
import { MODELS } from './models';
import { AppError, toResponse } from './errors';
import { getSessionUser } from './auth/session';
import { assertSameOrigin } from './api/route';

export class HttpError extends AppError {
  constructor(status, message, extra = {}) {
    super(status, extra.confirmable ? 'CONFIRM_REQUIRED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : 'BAD_REQUEST', message, Object.keys(extra).length ? extra : undefined);
  }
}

// Thrown by a hook to finish the request early with a success payload
export class Done {
  constructor(data) { this.data = data; }
}

export async function getSession() {
  const u = await getSessionUser();
  if (!u) return null;
  return { role: u.role, name: u.name, empCode: u.empCode, user: `${u.name} (${u.role})`, userId: u.id, preset: u.preset, mustChangePassword: u.mustChangePassword };
}

export async function requireSession() {
  const s = await getSession();
  if (!s) throw new HttpError(401, 'Please sign in');
  return s;
}

export function ok(data, init) {
  return NextResponse.json(data, init);
}

// Wrap a handler: CSRF origin check, connects DB, converts errors to the standard error envelope
export function handler(fn) {
  return async (req, ctx) => {
    const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
    try {
      assertSameOrigin(req);
      await connect();
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof Done) return NextResponse.json(e.data);
      return toResponse(e, requestId);
    }
  };
}

const trunc = (v) => {
  if (typeof v === 'string') return v.length > 120 ? v.slice(0, 117) + '…' : v;
  if (v && typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 160 ? s.slice(0, 157) + '…' : s;
  }
  return v;
};

export async function audit({ model, refId, action, session, changes, label }) {
  try {
    await MODELS.auditlogs.create({
      model, refId: String(refId || ''), action, by: session?.name || 'system', role: session?.role || '', byUserId: session?.userId || '',
      label: label || '', changes: changes || undefined, status: 'active',
    });
  } catch (e) {
    console.error('audit failed', e.message);
  }
}

export function diff(prev, next) {
  const out = {};
  for (const k of Object.keys(next)) {
    if (['updatedAt', 'createdAt', '_id', '__v', 'updatedBy'].includes(k)) continue;
    const a = JSON.stringify(prev?.[k]);
    const b = JSON.stringify(next[k]);
    if (a !== b) out[k] = { from: trunc(prev?.[k]), to: trunc(next[k]) };
  }
  return out;
}

export const plain = (d) => (d && d.toObject ? d.toObject() : d);
