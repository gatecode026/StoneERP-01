/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { Notification } from '@/lib/models';
import { connect } from '@/lib/db';
import { waLink } from '@/lib/notify/whatsapp';

export const dynamic = 'force-dynamic';

/** Messages the app has not been able to send by itself: waiting for a manual send, or failed. Newest first, with a one-tap WhatsApp link. */
export const GET = withAuth('settings', 'edit', async () => {
  await connect();
  const rows: any[] = await Notification.find({ status: { $in: ['manual', 'failed'] } }).sort({ createdAt: -1 }).limit(50).lean();
  return {
    data: rows.map((n) => ({ _id: n._id, kind: n.kind, to: n.to, text: n.text, status: n.status, error: n.error ?? null, createdAt: n.createdAt, link: waLink(n.to, n.text) })),
    automatic: process.env.WHATSAPP_PROVIDER === 'cloud' && !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_ID,
  };
});
