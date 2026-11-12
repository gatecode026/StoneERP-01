import { withAuth } from '@/lib/api/withAuth';
import { getEffectivePerm } from '@/lib/perm/engine';
import { jsonWithEtag } from '@/lib/api/http';
import { getBackupSectionsSummary } from '@/lib/export/sectionBackup';
import { parseBackupRange } from '@/lib/export/backupRange';

export const dynamic = 'force-dynamic';

/** GET /api/backups/sections?range=lifetime|month|custom&from=&to= - Summary count of all data sections (for the chosen period) */
export const GET = withAuth(
  async (c) => {
    const perm = await getEffectivePerm(c.user!);
    return perm.can('backups', 'view') ? 'backups' : 'settings';
  },
  'view',
  async (auth) => {
    const summary = await getBackupSectionsSummary(parseBackupRange(new URLSearchParams(auth.query)));
    return jsonWithEtag(auth.req, summary, { maxAge: 10 });
  }
);
