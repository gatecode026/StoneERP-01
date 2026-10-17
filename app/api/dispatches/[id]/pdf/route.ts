import { withAuth } from '@/lib/api/withAuth';
import { assertRow } from '@/lib/api/helpers';
import { getSettings } from '@/lib/settings';
import { gatePassDocument } from '@/lib/export/documents';
import { pdfResponse } from '@/lib/export/pdf';

export const dynamic = 'force-dynamic';
/** Gate pass as a PDF. Same rights and scope as the dispatch itself. */
export const GET = withAuth('dispatches', 'view', async (auth) => {
  const d = auth.project(await assertRow(auth, 'dispatches', 'view', auth.params.id)) as Record<string, unknown>;
  const { bytes, filename } = await gatePassDocument(d, (await getSettings()).company);
  return pdfResponse(bytes, filename);
});
