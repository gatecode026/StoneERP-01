import { withAuth } from '@/lib/api/withAuth';
import { computePerformance } from '@/lib/services/analytics';
import { monthQuery } from '@/lib/api/helpers';
import { monthOf, todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const GET = withAuth('performance', 'view', async (auth) => computePerformance(monthQuery.parse(auth.query.get('month') ?? monthOf(todayIST())), auth.user, auth.perm));
