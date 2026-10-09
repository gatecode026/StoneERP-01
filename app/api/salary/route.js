import { handler, requireSession, ok, HttpError } from '@/lib/server';
import { MODELS } from '@/lib/models';
import { computeSalary, sheetTotals } from '@/lib/analytics';
import { canView } from '@/lib/perm';
import { monthOf, todayISO } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req) => {
  const s = requireSession();
  if (!canView(s.role, 'salary')) throw new HttpError(403, 'No access');
  const sp = new URL(req.url).searchParams;
  const month = sp.get('month') || monthOf(todayISO());
  const only = s.role === 'worker' ? s.empCode : sp.get('empCode') || undefined;
  const sheet = await MODELS.salarysheets.findOne({ month, status: { $ne: 'void' } }).lean();
  let rows;
  const frozen = sheet && sheet.status !== 'draft';
  if (frozen) rows = only ? sheet.rows.filter((r) => r.empCode === only) : sheet.rows;
  else rows = await computeSalary(month, only);
  // keep paid flags from a saved draft (none expected) – drafts are always recomputed
  return ok({
    month,
    status: sheet?.status || 'preview',
    approvedBy: sheet?.approvedBy,
    approvedAt: sheet?.approvedAt,
    rows,
    totals: sheetTotals(rows),
    sheetId: sheet ? String(sheet._id) : null,
  });
});
