import { withAuth } from '@/lib/api/withAuth';
import { authorisedSlip } from '@/lib/api/slipAccess';

export const dynamic = 'force-dynamic';
/** The ONLY way a worker can see pay: their own slip. The salary sheet collection itself is never exposed to them. */
export const GET = withAuth('salaryslips', 'view', async (auth) => (await authorisedSlip(auth)).slip);
