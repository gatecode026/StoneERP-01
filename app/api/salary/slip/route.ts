import { withAuth } from '@/lib/api/withAuth';
import { getSlip } from '@/lib/services/salary';
import { monthQuery } from '@/lib/api/helpers';
import { getSettings } from '@/lib/settings';
import { scopeFilter } from '@/lib/perm/engine';
import { Employee } from '@/lib/models';
import { badRequest, notFound } from '@/lib/errors';
import { monthOf, todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';
/**
 * The ONLY way a worker can see pay: their own slip. The salary sheet collection itself is never exposed to them.
 * `empCode` is honoured only if it is inside the caller's salaryslips scope (own = themselves, team, all).
 */
export const GET = withAuth('salaryslips', 'view', async (auth) => {
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
  return getSlip(month, code, await getSettings());
});
