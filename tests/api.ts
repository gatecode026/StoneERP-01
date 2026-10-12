/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { User } from '@/lib/models';
import { hashPassword } from '@/lib/auth/password';
import { createSession, cookieName } from '@/lib/auth/session';
import { clearSettingsCache } from '@/lib/settings';
import { clearTeamCache } from '@/lib/perm/engine';
import { invalidate } from '@/lib/perm/store';
import * as generic from '@/app/api/[resource]/route';
import * as genericId from '@/app/api/[resource]/[id]/route';

export type Who = { cookie: string; id: string; username: string; role: string; preset: string | null };
let n = 0;

export async function makeUser(role: string, opts: { preset?: string | null; empCode?: string; extraAccess?: any[]; name?: string } = {}): Promise<Who> {
  const username = `98${String(10000000 + ++n)}`;
  const u = await User.create({ username, name: opts.name ?? `${role} ${n}`, role, preset: opts.preset ?? null, empCode: opts.empCode ?? null, extraAccess: opts.extraAccess ?? [], passwordHash: await hashPassword('Test-Pass-12345'), mustChangePassword: false });
  const { cookieValue } = await createSession(u._id);
  return { cookie: `${cookieName()}=${cookieValue}`, id: String(u._id), username, role, preset: opts.preset ?? null };
}

export async function call(who: Who | null, handler: (req: NextRequest, c: { params: Promise<Record<string, string>> }) => Promise<Response>, path: string, opts: { method?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const method = opts.method ?? 'GET';
  const req = new NextRequest(`http://localhost${path}`, {
    method,
    headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', ...(who ? { cookie: who.cookie } : {}), ...(opts.headers ?? {}) },
    body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(opts.body ?? {}),
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  let json: any = null;
  try { json = await res.clone().json(); } catch { /* empty */ }
  return { status: res.status, json, headers: res.headers };
}

/** Generic resource helpers: GET/POST /api/<resource>, GET/PATCH/DELETE /api/<resource>/<id>. */
export const api = {
  list: (w: Who | null, resource: string, qs = '') => call(w, generic.GET as never, `/api/${resource}${qs ? '?' + qs : ''}`, { params: { resource } }),
  create: (w: Who | null, resource: string, body: unknown, headers?: Record<string, string>) => call(w, generic.POST as never, `/api/${resource}`, { method: 'POST', body, params: { resource }, headers }),
  get: (w: Who | null, resource: string, id: string) => call(w, genericId.GET as never, `/api/${resource}/${id}`, { params: { resource, id } }),
  patch: (w: Who | null, resource: string, id: string, body: unknown) => call(w, genericId.PATCH as never, `/api/${resource}/${id}`, { method: 'PATCH', body, params: { resource, id } }),
  void: (w: Who | null, resource: string, id: string, reason = 'test') => call(w, genericId.DELETE as never, `/api/${resource}/${id}`, { method: 'DELETE', body: { reason }, params: { resource, id } }),
};

export function resetCaches() {
  clearSettingsCache();
  clearTeamCache();
  invalidate();
  void mongoose;
}
