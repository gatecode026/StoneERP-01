 
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import { ROLE_DEFAULTS } from '@/lib/perm/defaults';
import { RESOURCES } from '@/lib/perm/resources';
import { DEFS } from '@/lib/resources';
import { BASE_ROLES, PRESETS } from '@/lib/roles';
import * as approvalsRoute from '@/app/api/approvals/route';
import * as salarySheet from '@/app/api/salary/preview/route';
import * as rolesRoute from '@/app/api/roles/route';
import * as usersRoute from '@/app/api/users/route';

let db: Awaited<ReturnType<typeof useTestDb>>;
const people: Record<string, Who> = {};
const FAKE = '64b000000000000000000001';
const ROLE_KEYS = [...BASE_ROLES, ...PRESETS] as const;

beforeAll(async () => {
  db = await useTestDb('matrix');
  resetCaches();
  for (const r of ROLE_KEYS) {
    const base = (BASE_ROLES as readonly string[]).includes(r);
    people[r] = await makeUser(base ? r : 'worker', { preset: base ? null : r, empCode: `E${100 + Object.keys(people).length}` });
  }
});
afterAll(async () => { await db.close(); });

const resources = Object.keys(DEFS) as (keyof typeof DEFS)[];

describe('permission matrix, enforced at the API (every role × resource × action)', () => {
  for (const role of ROLE_KEYS) {
    describe(role, () => {
      for (const res of resources) {
        const g = ROLE_DEFAULTS[role].grants[res as keyof typeof RESOURCES] ?? {};
        const def = DEFS[res]!;
        it(`${res}: view=${g.view ?? '-'} create=${g.create ?? '-'} edit=${g.edit ?? '-'} void=${g.void ?? '-'}`, async () => {
          const who = people[role];
          // VIEW: list
          const list = await api.list(who, res as string);
          if (g.view) expect([200], `list ${res}`).toContain(list.status);
          else expect(list.status, `list ${res}`).toBe(403);
          // CREATE: an empty body is invalid. Allowed => 400 (validation), denied => 403. Never 200/201.
          const c = await api.create(who, res as string, {});
          if (g.create && def.create) expect([400, 403], `create ${res}`).toContain(c.status);
          if (!g.create) expect(c.status, `create ${res}`).toBe(403);
          expect(c.status).not.toBe(201);
          // EDIT: unknown id. Allowed => 400/404, denied => 403
          const e = await api.patch(who, res as string, FAKE, { x: 1 });
          if (!g.edit) expect(e.status, `edit ${res}`).toBe(403);
          else expect([400, 403, 404], `edit ${res}`).toContain(e.status);
          // VOID
          const v = await api.void(who, res as string, FAKE);
          if (!g.void) expect(v.status, `void ${res}`).toBe(403);
          else expect([404, 409], `void ${res}`).toContain(v.status);
        });
      }
    });
  }
});

describe('admin resources and special endpoints', () => {
  it('only the Owner can open roles and users by default', async () => {
    for (const r of ROLE_KEYS) {
      const roles = await call(people[r], rolesRoute.GET as never, '/api/roles');
      const users = await call(people[r], usersRoute.GET as never, '/api/users');
      expect(roles.status, `roles ${r}`).toBe(r === 'owner' ? 200 : 403);
      expect(users.status, `users ${r}`).toBe(r === 'owner' ? 200 : 403);
    }
  });
  it('the salary sheet is closed to supervisor, salesperson, worker and all job presets', async () => {
    for (const r of ROLE_KEYS) {
      const s = await call(people[r], salarySheet.GET as never, '/api/salary/preview?month=2026-09');
      const allowed = Boolean(ROLE_DEFAULTS[r].grants.salarysheets?.view);
      expect(s.status, `sheet ${r}`).toBe(allowed ? 200 : 403);
    }
    for (const r of ['supervisor', 'salesperson', 'worker', 'guard', 'driver', 'mechanic', 'cashier', 'store_keeper', 'yard_incharge'] as const) {
      expect(ROLE_DEFAULTS[r].grants.salarysheets).toBeUndefined();
    }
  });
  it('approvals: only roles with the approve right see anything, and unauthenticated calls are 401', async () => {
    expect((await call(null, approvalsRoute.GET as never, '/api/approvals')).status).toBe(401);
    const sup = await call(people.supervisor, approvalsRoute.POST as never, '/api/approvals', { method: 'POST', body: { model: 'expenses', id: FAKE, action: 'approve' } });
    expect(sup.status).toBe(403);
    const own = await call(people.owner, approvalsRoute.POST as never, '/api/approvals', { method: 'POST', body: { model: 'expenses', id: FAKE, action: 'approve' } });
    expect(own.status).toBe(404);
  });
  it('the default matrix follows the PDF: manager cannot approve salary or damage; only the owner approves salary sheets', () => {
    expect(ROLE_DEFAULTS.owner.grants.salarysheets?.approve).toBe('all');
    for (const r of ROLE_KEYS.filter((x) => x !== 'owner')) expect(ROLE_DEFAULTS[r].grants.salarysheets?.approve, r).toBeUndefined();
    expect(ROLE_DEFAULTS.manager.grants.stockmovements?.approve).toBeUndefined();
    expect(ROLE_DEFAULTS.manager.grants.documents).toBeUndefined();
    expect(ROLE_DEFAULTS.accountant.grants.documents?.view).toBe('all');
    expect(ROLE_DEFAULTS.supervisor.grants.documents).toBeUndefined(); // Important papers: owner and people he allows (PDF Part 18)
    expect(ROLE_DEFAULTS.supervisor.grants.purchases).toBeUndefined();
    expect(ROLE_DEFAULTS.salesperson.grants.purchases).toBeUndefined();
  });
});
