import { withAuth } from '@/lib/api/withAuth';
import { computeReminders } from '@/lib/services/analytics';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const GET = withAuth('reminders', 'view', async (auth) => computeReminders(auth.user, auth.perm, await getSettings()));
