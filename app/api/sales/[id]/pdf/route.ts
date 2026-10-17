import { withAuth } from '@/lib/api/withAuth';
import { assertRow } from '@/lib/api/helpers';
import { getSettings } from '@/lib/settings';
import { saleDocument } from '@/lib/export/documents';
import { pdfResponse } from '@/lib/export/pdf';

export const dynamic = 'force-dynamic';
/** Quotation or tax invoice as a PDF (?type=quotation for the quotation). Same rights, scope and hidden fields as the sale itself. */
export const GET = withAuth('sales', 'view', async (auth) => {
  const sale = auth.project(await assertRow(auth, 'sales', 'view', auth.params.id)) as Record<string, unknown>;
  const { bytes, filename } = await saleDocument(sale, (await getSettings()).company, auth.query.get('type') === 'quotation' ? 'quotation' : 'invoice');
  return pdfResponse(bytes, filename);
});
