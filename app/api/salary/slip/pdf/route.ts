import { withAuth } from '@/lib/api/withAuth';
import { authorisedSlip } from '@/lib/api/slipAccess';
import { salarySlipDocument } from '@/lib/export/documents';
import { pdfResponse } from '@/lib/export/pdf';

export const dynamic = 'force-dynamic';
/** Salary slip as a PDF (?month=YYYY-MM&empCode=E001&lang=en|hi). Same rights and scope as the JSON slip. */
export const GET = withAuth('salaryslips', 'view', async (auth) => {
  const { slip, settings } = await authorisedSlip(auth);
  const { bytes, filename } = await salarySlipDocument(slip, settings.company, auth.query.get('lang') === 'hi' ? 'hi' : 'en');
  return pdfResponse(bytes, filename);
});
