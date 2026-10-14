import { Readable } from 'node:stream';
import { withAuth } from '@/lib/api/withAuth';
import { backupStream } from '@/lib/backup';
import { writeAudit } from '@/lib/audit';
import { enforce } from '@/lib/auth/ratelimit';
import { todayIST } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The Owner downloads the whole database as one file (no password hashes). Streamed, rate-limited and audit-logged. */
export const GET = withAuth('settings', 'edit', async (auth) => {
  await enforce(`backup:${auth.user.id}`, 3, 3600);
  await writeAudit({ resource: 'backup', action: 'export', label: 'Full backup downloaded', requestId: auth.requestId },
    { id: auth.user.id, name: auth.user.name, role: auth.user.role, preset: auth.user.preset, empCode: auth.user.empCode });
  return new Response(Readable.toWeb(backupStream()) as unknown as ReadableStream, {
    headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="vipul-stone-backup-${todayIST()}.ndjson.gz"`, 'cache-control': 'no-store' },
  });
});
