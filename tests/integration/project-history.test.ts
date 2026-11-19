/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../helpers';
import { api, call, makeUser, resetCaches, type Who } from '../api';
import * as history from '@/app/api/projects/[id]/history/route';

// The project's "Pieces Update History": who changed the completed pieces, from what to what, and when.
let db: Awaited<ReturnType<typeof useTestDb>>;
let owner: Who, manager: Who;
const read = (w: Who, id: string) => call(w, history.GET as never, `/api/projects/${id}/history`, { params: { id } as any });

beforeAll(async () => {
  db = await useTestDb('projhistory');
  resetCaches();
  owner = await makeUser('owner', { name: 'Owner One' });
  manager = await makeUser('manager', { name: 'Manager Two' });
});
afterAll(async () => { await db.close(); });

describe('project pieces history', () => {
  it('lists every change to the completed pieces with the name and time, newest first; other edits are left out', async () => {
    const p = (await api.create(owner, 'projects', { name: 'Kiba Stores', targetDate: '2026-12-31', qtyInPcs: 100 })).json;
    expect((await api.patch(owner, 'projects', p._id, { completedPcs: 40 })).status).toBe(200);
    expect((await api.patch(owner, 'projects', p._id, { notes: 'not a pieces change' })).status).toBe(200);
    expect((await api.patch(manager, 'projects', p._id, { completedPcs: 100, status: 'Completed' })).status).toBe(200);
    const r = await read(owner, p._id);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const rows = r.json.rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ from: 40, to: 100, status: 'Completed', by: 'Manager Two' });
    expect(rows[1]).toMatchObject({ from: 0, to: 40, by: 'Owner One' });
    expect(rows[2]).toMatchObject({ action: 'create', to: null });
    expect(new Date(rows[0].at).getTime()).toBeGreaterThan(0);
  });

  it('an unknown project is not found', async () => {
    expect((await read(owner, '64b000000000000000000000')).status).toBe(404);
  });
});
