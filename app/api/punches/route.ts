import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { action } from '@/lib/api/helpers';
import { recordPunch } from '@/lib/services/punch';
import { Punch } from '@/lib/models';
import { scopeFilter } from '@/lib/perm/engine';
import { isISODate } from '@/lib/time';
import { badRequest } from '@/lib/errors';
import { empCode } from '@/lib/resources/zod';

export const dynamic = 'force-dynamic';

/**
 * Punch In / Punch Out. Who: yourself (the default) or, with the right for a team / everybody, a colleague (testing the machine).
 * The server stamps the time. With no `type` the next press does the sensible thing: Out when punched in, otherwise In.
 */
export const POST = withAuth('punches', 'create', async (auth) => {
  const b = await auth.json(z.object({ empCode: empCode.optional(), type: z.enum(['in', 'out']).optional() }).strict());
  const r = await action(auth, { resource: 'punches', action: 'punch', silent: true }, async (ctx) => ({ result: await recordPunch(ctx, auth, b) }));
  return NextResponse.json(r, { status: r.ignored ? 200 : 201 });
});

/** The raw punches (newest first) of the people this user may see: ?date=YYYY-MM-DD and/or ?empCode=… */
export const GET = withAuth('punches', 'view', async (auth) => {
  const date = auth.query.get('date');
  if (date && !isISODate(date)) throw badRequest('date must be YYYY-MM-DD');
  const code = auth.query.get('empCode');
  const sf = await scopeFilter(auth.user, auth.perm, 'punches', 'view');
  const rows = await Punch.find({ $and: [{ isVoid: false }, sf, ...(date ? [{ date }] : []), ...(code ? [{ empCode: code.toUpperCase() }] : [])] })
    .sort({ at: -1 }).limit(Math.min(Number(auth.query.get('limit')) || 100, 300)).select('empCode empName at type date source deviceId punchedBy').lean();
  return { data: rows };
});
