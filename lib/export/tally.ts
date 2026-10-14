/* eslint-disable @typescript-eslint/no-explicit-any */
// Tally Prime / ERP 9 import file (XML): the ledgers first, then the vouchers, in one envelope.
//   Sales invoices    -> Sales voucher    (customer Dr; Sales + CGST/SGST or IGST + Round off Cr)
//   Purchases         -> Purchase voucher (Purchases + Input GST Dr; supplier Cr)
//   Customer receipts -> Receipt voucher  (Cash / Bank Dr; customer Cr)
//   Expenses          -> Payment voucher  (expense head Dr; Cash / Bank Cr)
// Tally's sign rule: a debit line is "deemed positive" with a NEGATIVE amount, a credit line is positive. Every voucher adds up to zero.
// Importing the same file twice creates the vouchers twice, so export each date range once.

export const LEDGERS = {
  sales: 'Sales', purchases: 'Purchases', cgst: 'Output CGST', sgst: 'Output SGST', igst: 'Output IGST', inputGst: 'Input GST',
  roundOff: 'Round Off', cash: 'Cash', bank: 'Bank Account',
} as const;

// XML 1.0 cannot carry most control characters: drop them, then escape the five special characters
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
const esc = (v: unknown) => String(v ?? '').replace(CONTROL, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const day = (d: string) => d.replace(/-/g, ''); // 2026-10-14 -> 20261014
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const amt = (n: number) => r2(n).toFixed(2);

type Line = { ledger: string; debit?: number; credit?: number };

function voucher(type: string, date: string, number: string, party: string, narration: string, lines: Line[]) {
  const rows = lines
    .filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)
    .map((l) => (l.debit
      ? `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amt(l.debit)}</AMOUNT></ALLLEDGERENTRIES.LIST>`
      : `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(l.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amt(l.credit!)}</AMOUNT></ALLLEDGERENTRIES.LIST>`));
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${esc(type)}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${day(date)}</DATE><VOUCHERTYPENAME>${esc(type)}</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(number)}</VOUCHERNUMBER>${party ? `<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>` : ''}<NARRATION>${esc(narration)}</NARRATION>${rows.join('')}</VOUCHER></TALLYMESSAGE>`;
}

const ledgerMaster = (name: string, parent: string) => `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><PARENT>${esc(parent)}</PARENT></LEDGER></TALLYMESSAGE>`;
const payLedger = (mode: string) => (/^cash$/i.test(mode) ? LEDGERS.cash : LEDGERS.bank);

export type TallyInput = { company: string; sales?: any[]; purchases?: any[]; payments?: any[]; expenses?: any[] };

/** Pure: documents in, one XML string out. A record that would not balance is listed in `skipped` instead of being written. */
export function buildTally(input: TallyInput) {
  const vouchers: string[] = [];
  const skipped: string[] = [];
  const debtors = new Set<string>(); const creditors = new Set<string>(); const expenseHeads = new Set<string>();
  const counts = { sales: 0, purchases: 0, receipts: 0, payments: 0 };

  for (const s of input.sales ?? []) {
    const total = Number(s.total) || 0;
    const ro = Number(s.roundOff) || 0;
    const credits = (Number(s.taxable) || 0) + (Number(s.cgst) || 0) + (Number(s.sgst) || 0) + (Number(s.igst) || 0) + ro;
    if (Math.abs(total - credits) > 0.01 || !s.customerName) { skipped.push(`Sale ${s.invoiceNo ?? s.saleNo}: amounts do not add up`); continue; }
    debtors.add(s.customerName);
    vouchers.push(voucher('Sales', s.invoiceDate ?? s.date, s.invoiceNo ?? s.saleNo, s.customerName, `Sale ${s.saleNo}`, [
      { ledger: s.customerName, debit: total }, { ledger: LEDGERS.sales, credit: s.taxable },
      { ledger: LEDGERS.cgst, credit: s.cgst }, { ledger: LEDGERS.sgst, credit: s.sgst }, { ledger: LEDGERS.igst, credit: s.igst },
      ro >= 0 ? { ledger: LEDGERS.roundOff, credit: ro } : { ledger: LEDGERS.roundOff, debit: -ro },
    ]));
    counts.sales++;
  }

  for (const p of input.purchases ?? []) {
    const total = Number(p.total) || 0;
    if (!(total > 0) || !p.supplierName) { skipped.push(`Purchase ${p.billNo ?? p._id}: no amount or supplier`); continue; }
    const base = r2(p.gstPercent ? total / (1 + p.gstPercent / 100) : total);
    creditors.add(p.supplierName);
    vouchers.push(voucher('Purchase', p.date, p.billNo || String(p._id).slice(-8), p.supplierName, `${p.itemName ?? ''} ${p.qty ?? ''}`.trim(), [
      { ledger: LEDGERS.purchases, debit: base }, { ledger: LEDGERS.inputGst, debit: r2(total - base) }, { ledger: p.supplierName, credit: total },
    ]));
    counts.purchases++;
  }

  for (const r of input.payments ?? []) {
    if (!(r.amount > 0) || !r.customerName) { skipped.push(`Receipt ${r._id}: no amount or customer`); continue; }
    debtors.add(r.customerName);
    vouchers.push(voucher('Receipt', r.date, `R-${String(r._id).slice(-8)}`, r.customerName, `${r.kind === 'advance' ? 'Advance' : 'Payment'} ${r.saleNo ?? ''} ${r.ref ?? ''}`.trim(), [
      { ledger: payLedger(r.mode), debit: r.amount }, { ledger: r.customerName, credit: r.amount },
    ]));
    counts.receipts++;
  }

  for (const e of input.expenses ?? []) {
    if (!(e.amount > 0) || !e.head) { skipped.push(`Expense ${e._id}: no amount or head`); continue; }
    expenseHeads.add(e.head);
    vouchers.push(voucher('Payment', e.date, `P-${String(e._id).slice(-8)}`, '', `${e.head}${e.paidTo ? ' - ' + e.paidTo : ''}${e.narration ? ': ' + e.narration : ''}`, [
      { ledger: e.head, debit: e.amount }, { ledger: payLedger(e.paidBy), credit: e.amount },
    ]));
    counts.payments++;
  }

  const masters = [
    ledgerMaster(LEDGERS.sales, 'Sales Accounts'), ledgerMaster(LEDGERS.purchases, 'Purchase Accounts'),
    ledgerMaster(LEDGERS.cgst, 'Duties & Taxes'), ledgerMaster(LEDGERS.sgst, 'Duties & Taxes'), ledgerMaster(LEDGERS.igst, 'Duties & Taxes'), ledgerMaster(LEDGERS.inputGst, 'Duties & Taxes'),
    ledgerMaster(LEDGERS.roundOff, 'Indirect Expenses'), ledgerMaster(LEDGERS.cash, 'Cash-in-Hand'), ledgerMaster(LEDGERS.bank, 'Bank Accounts'),
    ...[...debtors].sort().map((n) => ledgerMaster(n, 'Sundry Debtors')),
    ...[...creditors].filter((n) => !debtors.has(n)).sort().map((n) => ledgerMaster(n, 'Sundry Creditors')),
    ...[...expenseHeads].sort().map((n) => ledgerMaster(n, 'Indirect Expenses')),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(input.company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${masters.join('')}${vouchers.join('')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
  return { xml, counts, skipped };
}
