/* eslint-disable @typescript-eslint/no-explicit-any */
import { withAuth } from '@/lib/api/withAuth';
import { badRequest, forbidden } from '@/lib/errors';
import { Expense, Payment, Purchase, Sale } from '@/lib/models';
import { connect } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { hiddenFields } from '@/lib/perm/engine';
import { writeAudit } from '@/lib/audit';
import { buildTally } from '@/lib/export/tally';
import { daysBetween, isISODate } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_ROWS = 20_000;
const TYPES = ['sales', 'purchases', 'receipts', 'payments'] as const;

/**
 * GET /api/export/tally?from=YYYY-MM-DD&to=YYYY-MM-DD[&types=sales,purchases,receipts,payments]
 * An XML file for Tally (Import Data): ledgers first, then the vouchers. Needs the export right on every kind of record asked for,
 * over everyone's records (a salesperson who may only export their own sales cannot get the company's books), and the cost columns
 * for purchases. Every download is audit-logged.
 */
export const GET = withAuth('sales', 'export', async (auth) => {
  const from = auth.query.get('from') ?? '';
  const to = auth.query.get('to') ?? '';
  if (!isISODate(from) || !isISODate(to) || from > to) throw badRequest('Choose a valid From and To date');
  if (daysBetween(from, to) > 366) throw badRequest('Choose a range of at most one year');
  const asked = (auth.query.get('types') ?? TYPES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  if (!asked.length || asked.some((t) => !(TYPES as readonly string[]).includes(t))) throw badRequest(`types can be: ${TYPES.join(', ')}`);

  const needs: Record<string, 'sales' | 'purchases' | 'expenses'> = { sales: 'sales', receipts: 'sales', purchases: 'purchases', payments: 'expenses' };
  for (const t of asked) {
    const res = needs[t];
    if (auth.perm.scope(res, 'export') !== 'all') throw forbidden(`You cannot export ${t} for the whole company`);
    if (res === 'purchases' && hiddenFields(auth.perm, 'purchases').has('total')) throw forbidden('You cannot see purchase amounts');
  }

  await connect();
  const settings = await getSettings();
  const range = { $gte: from, $lte: to };
  const live = { isVoid: { $ne: true } };
  const [sales, purchases, payments, expenses] = await Promise.all([
    asked.includes('sales') ? Sale.find({ ...live, invoiceNo: { $gt: '' }, invoiceDate: range }).sort({ invoiceDate: 1, invoiceNo: 1 }).limit(MAX_ROWS + 1).lean() : [],
    asked.includes('purchases') ? Purchase.find({ ...live, status: 'approved', date: range }).sort({ date: 1 }).limit(MAX_ROWS + 1).lean() : [],
    asked.includes('receipts') ? Payment.find({ ...live, date: range }).sort({ date: 1 }).limit(MAX_ROWS + 1).lean() : [],
    asked.includes('payments') ? Expense.find({ ...live, status: 'approved', date: range }).sort({ date: 1 }).limit(MAX_ROWS + 1).lean() : [],
  ]);
  if ([sales, purchases, payments, expenses].some((x) => x.length > MAX_ROWS)) throw badRequest('Too many records in this range: choose a shorter range');

  const { xml, counts, skipped } = buildTally({ company: settings.company.name, sales, purchases, payments, expenses });
  const base = await auth.svc();
  await writeAudit({ resource: 'tally', action: 'export', label: `Tally ${from} to ${to}`, changes: { counts: { to: counts }, skipped: { to: skipped.length } }, requestId: auth.requestId }, base.actor);
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="tally-${from}-to-${to}.xml"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Tally-Counts': JSON.stringify(counts),
      'X-Tally-Skipped': String(skipped.length),
    },
  });
});
