import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { Notification } from '@/lib/models';
import { connect } from '@/lib/db';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const body = z.object({ status: z.enum(['sent', 'skipped']) });

/** The Owner sent the message by hand ("sent") or decided not to send it ("skipped"). */
export const PATCH = withAuth('settings', 'edit', async (auth) => {
  const { status } = await auth.json(body);
  await connect();
  const r = await Notification.updateOne({ _id: auth.params.id, status: { $in: ['manual', 'failed'] } }, { $set: { status, ...(status === 'sent' ? { sentAt: new Date() } : {}) } });
  if (!r.matchedCount) throw notFound();
  return { ok: true };
});
