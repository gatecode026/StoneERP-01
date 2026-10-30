import { withAuth } from '@/lib/api/withAuth';
import { getEffectivePerm } from '@/lib/perm/engine';
import { jsonWithEtag } from '@/lib/api/http';
import { getBackupSectionsSummary } from '@/lib/export/sectionBackup';

export const dynamic = 'force-dynamic';

/** GET /api/backups/sections - Summary count of all data sections */
export const GET = withAuth(
  async (c) => {
    const perm = await getEffectivePerm(c.user!);
    return perm.can('backups', 'view') ? 'backups' : 'settings';
  },
  'view',
  async (auth) => {
    const summary = await getBackupSectionsSummary();
    return jsonWithEtag(auth.req, summary, { maxAge: 10 });
  }
);
