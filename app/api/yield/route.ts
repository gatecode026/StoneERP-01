import { jsonWithEtag, stripNulls } from '@/lib/api/http';
import { withAuth } from '@/lib/api/withAuth';
import { computeYield } from '@/lib/services/analytics';
import { getSettings } from '@/lib/settings';
import { projectDoc } from '@/lib/perm/engine';
import { fieldLevel } from '@/lib/perm/engine';

export const dynamic = 'force-dynamic';
export const GET = withAuth('yield', 'view', async (auth) => {
  const data = await computeYield(await getSettings());
  // cost fields are stripped for anyone without cost access (supervisor, salesperson…)
  const hideCost = fieldLevel(auth.perm, 'yield', 'totalCost') !== 'write' && fieldLevel(auth.perm, 'yield', 'totalCost') !== 'read';
  const rows = data.rows.map((r) => projectDoc(auth.perm, 'yield', r as never));
  const bySupplier = data.bySupplier.map((r) => {
    const { costPerSqft, ...rest } = r;
    return hideCost ? rest : { ...rest, costPerSqft };
  });
  return jsonWithEtag(auth.req, stripNulls({ ...data, rows, bySupplier, hideCost }));
});
