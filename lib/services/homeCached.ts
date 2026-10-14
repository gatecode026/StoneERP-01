import { createHash } from 'node:crypto';
import { buildHome } from './home';
import { cached } from '../cache';
import { permVersion } from '../perm/store';
import { getSettings } from '../settings';
import type { SessionUser } from '../auth/session';
import type { EffectivePerm } from '../perm/engine';

/**
 * One person's home for one day, cached for 30 s and dropped the moment anything is committed (lib/db.ts). The key holds the person, their
 * effective rights and the permission-set version, so one role's numbers can never be served to another. Used by BOTH the API route
 * (/api/home) and the server-rendered home page, so the two always agree.
 */
export async function homeFor(user: SessionUser, perm: EffectivePerm, date: string) {
  const rights = createHash('sha1').update(JSON.stringify([perm.roleKey, user.extraAccess])).digest('hex').slice(0, 10);
  return cached(`home:${user.id}:${rights}:${permVersion()}:${date}`, 30_000, ['home'], async () => buildHome(date, user, perm, await getSettings()));
}
