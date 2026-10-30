import { withAuth } from '@/lib/api/withAuth';
import { getEffectivePerm } from '@/lib/perm/engine';
import { badRequest, notFound } from '@/lib/errors';
import {
  getSectionMeta,
  generateSectionExcel,
  generateSectionCsv,
  generateSectionPdf,
} from '@/lib/export/sectionBackup';
import { todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const GET = withAuth(
  async (c) => {
    const perm = await getEffectivePerm(c.user!);
    return perm.can('backups', 'view') ? 'backups' : 'settings';
  },
  'view',
  async (auth) => {
    const q = new URLSearchParams(auth.query);
    const sectionId = q.get('section');
    const format = (q.get('format') || 'xlsx').toLowerCase();

    if (!sectionId) throw badRequest('Missing "section" parameter');
    const meta = getSectionMeta(sectionId);
    if (!meta) throw notFound(`Section "${sectionId}" not found`);

    const dateStr = todayIST();
    const safeName = meta.id;

    if (format === 'xlsx') {
      const buf = await generateSectionExcel(meta);
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${safeName}-backup-${dateStr}.xlsx"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (format === 'csv') {
      const buf = await generateSectionCsv(meta);
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeName}-backup-${dateStr}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (format === 'pdf') {
      const buf = await generateSectionPdf(meta);
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${safeName}-backup-${dateStr}.pdf"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    throw badRequest(`Unsupported format "${format}". Choose xlsx, csv, or pdf.`);
  }
);
