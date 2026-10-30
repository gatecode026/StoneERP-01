import { withAuth } from '@/lib/api/withAuth';
import { getEffectivePerm } from '@/lib/perm/engine';
import { badRequest } from '@/lib/errors';
import { generateAllSectionsZip } from '@/lib/export/sectionBackup';
import { todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const GET = withAuth(
  async (c) => {
    const perm = await getEffectivePerm(c.user!);
    return perm.can('backups', 'view') ? 'backups' : 'settings';
  },
  'view',
  async (auth) => {
    const q = new URLSearchParams(auth.query);
    const format = (q.get('format') || 'xlsx').toLowerCase() as 'all' | 'xlsx' | 'csv' | 'pdf';

    if (!['all', 'xlsx', 'csv', 'pdf'].includes(format)) {
      throw badRequest(`Invalid format "${format}". Choose all, xlsx, csv, or pdf.`);
    }

    const zipBuffer = await generateAllSectionsZip(format);
    const dateStr = todayIST();
    const filename = `stoneerp-all-sections-${format}-backup-${dateStr}.zip`;

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  }
);
