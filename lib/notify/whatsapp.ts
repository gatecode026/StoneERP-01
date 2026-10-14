/* eslint-disable @typescript-eslint/no-explicit-any */
import { Notification } from '../models';
import { connect } from '../db';
import { logger } from '../logger';

/**
 * Delivery of the messages the app queues (daily report, payment reminders).
 *
 *   WHATSAPP_PROVIDER=cloud + WHATSAPP_TOKEN + WHATSAPP_PHONE_ID   → sent through the WhatsApp Business Cloud API
 *   (anything else)                                                → NOT sent automatically: the message waits as "manual" and the
 *                                                                     Owner opens it in WhatsApp with one tap (a wa.me link) and marks it sent
 *
 * WhatsApp only lets a business start a conversation with an approved TEMPLATE. Set WHATSAPP_TEMPLATE to the name of a template whose
 * body is exactly "{{1}}" (and WHATSAPP_TEMPLATE_LANG, default "en") to send the text that way; without it the text is sent as an
 * ordinary message, which WhatsApp delivers only if the person wrote to the business in the last 24 hours.
 */
export const MAX_ATTEMPTS = 5;

export const waLink = (to: string, text: string) => `https://wa.me/91${to.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(text)}`;
const configured = () => process.env.WHATSAPP_PROVIDER === 'cloud' && !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_ID;

type Outcome = { ok: true } | { ok: false; error: string; retry: boolean };

async function deliver(n: { to: string; text: string }): Promise<Outcome> {
  const e = process.env;
  const body = e.WHATSAPP_TEMPLATE
    ? { messaging_product: 'whatsapp', to: `91${n.to}`, type: 'template', template: { name: e.WHATSAPP_TEMPLATE, language: { code: e.WHATSAPP_TEMPLATE_LANG || 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: n.text.slice(0, 1000) }] }] } }
    : { messaging_product: 'whatsapp', to: `91${n.to}`, type: 'text', text: { body: n.text, preview_url: false } };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${e.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${e.WHATSAPP_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    const detail = await res.json().catch(() => null);
    const msg = `WhatsApp ${res.status}: ${detail?.error?.message ?? 'rejected'}`.slice(0, 300);
    // 429 and 5xx are worth another try; any other 4xx (bad number, template not approved, token wrong) will fail the same way again
    return { ok: false, error: msg, retry: res.status === 429 || res.status >= 500 };
  } catch (err: any) {
    return { ok: false, error: `Network: ${String(err?.message ?? err)}`.slice(0, 300), retry: true };
  }
}

/** Work through the outbox: send what can be sent, park the rest for a manual send. Safe to call any number of times. */
export async function sendQueued(limit = 50) {
  await connect();
  const auto = configured();
  const out = { sent: 0, failed: 0, retry: 0, manual: 0 };
  const rows: any[] = await Notification.find({ status: 'queued', channel: 'whatsapp', attempts: { $lt: MAX_ATTEMPTS } }).sort({ createdAt: 1 }).limit(limit).lean();
  for (const n of rows) {
    // claim the row first so two overlapping runs never send the same message twice
    const claim = await Notification.findOneAndUpdate({ _id: n._id, status: 'queued' }, { $set: { status: auto ? 'sending' : 'manual' }, $inc: { attempts: auto ? 1 : 0 } }, { returnDocument: 'after' });
    if (!claim) continue;
    if (!auto) { out.manual++; continue; }
    const r = await deliver(n);
    if (r.ok) { await Notification.updateOne({ _id: n._id }, { $set: { status: 'sent', sentAt: new Date() }, $unset: { error: 1 } }); out.sent++; }
    else if (r.retry && claim.attempts < MAX_ATTEMPTS) { await Notification.updateOne({ _id: n._id }, { $set: { status: 'queued', error: r.error } }); out.retry++; }
    else { await Notification.updateOne({ _id: n._id }, { $set: { status: 'failed', error: r.error } }); out.failed++; logger.warn({ id: n._id, error: r.error }, 'message not delivered'); }
  }
  // a run that crashed between claim and result leaves "sending" rows behind: put them back after 15 minutes
  await Notification.updateMany({ status: 'sending', updatedAt: { $lt: new Date(Date.now() - 15 * 60_000) } }, { $set: { status: 'queued' } });
  return out;
}
