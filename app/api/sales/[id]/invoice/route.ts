import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/withAuth';
import { action, assertRow } from '@/lib/api/helpers';
import { issueInvoice } from '@/lib/resources/selling';

export const dynamic = 'force-dynamic';
export const POST = withAuth('invoices', 'create', async (auth) => {
  await assertRow(auth, 'sales', 'view', auth.params.id);
  const sale = await action(auth, { resource: 'sales', refId: auth.params.id, action: 'invoice' }, async (ctx) => {
    const s = await issueInvoice(ctx, auth.params.id);
    return { result: s, label: s.invoiceNo };
  });
  return NextResponse.json({ invoiceNo: sale.invoiceNo, invoiceDate: sale.invoiceDate });
});
