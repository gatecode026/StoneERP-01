import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { connect } from './db';
import { MODELS } from './models';
import { ROLE_USERS } from './perm';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Thrown by a hook to finish the request early with a success payload
export class Done {
  constructor(data) { this.data = data; }
}

export function getSession() {
  const c = cookies();
  const dec = (k) => {
    const v = c.get(k)?.value;
    return v ? decodeURIComponent(v) : null;
  };
  const role = dec('vss_role');
  if (!role || !ROLE_USERS[role]) return null;
  const empCode = dec('vss_emp');
  const name = dec('vss_name') || ROLE_USERS[role].name;
  return { role, name, empCode, user: `${name} (${role})` };
}

export function requireSession() {
  const s = getSession();
  if (!s) throw new HttpError(401, 'Please log in (choose a role)');
  return s;
}

export function ok(data, init) {
  return NextResponse.json(data, init);
}

// Wrap a handler: connects DB, converts errors to JSON
export function handler(fn) {
  return async (req, ctx) => {
    try {
      await connect();
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof Done) return NextResponse.json(e.data);
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
      }
      console.error('API error:', e);
      return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 });
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
      model, refId: String(refId || ''), action, by: session?.name || 'system', role: session?.role || '',
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
