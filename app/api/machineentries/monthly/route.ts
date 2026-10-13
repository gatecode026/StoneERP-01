/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { MachineEntry } from '@/lib/models';
import { monthEnd, monthOf, monthStart, todayIST } from '@/lib/time';
import { monthQuery } from '@/lib/api/helpers';

export const dynamic = 'force-dynamic';
const r1 = (n: unknown) => Math.round((Number(n) || 0) * 10) / 10;

/** Monthly machine output in one aggregate: per machine (output, idle hours, breakdown hours) and per operator. Limited to the caller's scope. */
export const GET = withAuth('machineentries', 'view', async (auth) => {
  const month = monthQuery.parse(auth.query.get('month') ?? monthOf(todayIST()));
  const sf = await auth.filter('view');
  const match = { $and: [{ isVoid: false, date: { $gte: monthStart(month), $lte: monthEnd(month) } }, ...(Object.keys(sf).length ? [sf] : [])] };
  const [r]: any[] = await MachineEntry.aggregate([{ $match: match }, { $facet: {
    byMachine: [{ $group: { _id: { $ifNull: ['$machineName', '—'] }, sqft: { $sum: { $ifNull: ['$outputSqft', 0] } }, stopped: { $sum: { $ifNull: ['$stoppedMins', 0] } }, breakdown: { $sum: { $cond: ['$breakdown', { $ifNull: ['$stoppedMins', 0] }, 0] } }, shifts: { $sum: 1 } } }, { $sort: { sqft: -1 } }, { $limit: 60 }],
    byOperator: [{ $match: { operatorName: { $nin: [null, ''] }, outputSqft: { $gt: 0 } } }, { $group: { _id: '$operatorName', sqft: { $sum: '$outputSqft' }, shifts: { $sum: 1 } } }, { $sort: { sqft: -1 } }, { $limit: 60 }],
  } }]);
  return {
    month,
    byMachine: (r?.byMachine ?? []).map((x: any) => ({ name: x._id, sqft: Math.round(x.sqft), shifts: x.shifts, stopped: r1(x.stopped / 60), breakdown: r1(x.breakdown / 60) })),
    byOperator: (r?.byOperator ?? []).map((x: any) => ({ name: x._id, sqft: Math.round(x.sqft), shifts: x.shifts })),
  };
});
