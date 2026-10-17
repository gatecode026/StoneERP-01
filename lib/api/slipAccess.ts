import type { AuthCtx } from './withAuth';
import { getSlip } from '../services/salary';
import { monthQuery } from './helpers';
import { getSettings } from '../settings';
import { scopeFilter } from '../perm/engine';
import { Employee } from '../models';
import { badRequest, notFound } from '../errors';
import { monthOf, todayIST } from '../time';

/**
 * The slip the caller is allowed to see (JSON and PDF share this rule).
 * `empCode` is honoured only if it is inside the caller's salaryslips scope (own = themselves, team, all).
 */
export async function authorisedSlip(auth: AuthCtx) {
  const month = monthQuery.parse(auth.query.get('month') ?? monthOf(todayIST()));
  let code = auth.query.get('empCode')?.toUpperCase() ?? null;
  if (auth.scope === 'own') {
    if (!auth.user.empCode) throw badRequest('Your login is not linked to an employee profile. Ask the Owner.');
    if (code && code !== auth.user.empCode) throw notFound();
    code = auth.user.empCode;
  }
  if (!code) throw badRequest('empCode is required');
  const sf = await scopeFilter(auth.user, auth.perm, 'salaryslips', 'view');
  const ok = await Employee.exists({ $and: [{ empCode: code, isVoid: false }, sf] });
  if (!ok) throw notFound();
  const settings = await getSettings();
  return { slip: await getSlip(month, code, settings), settings };
}
