/* eslint-disable @typescript-eslint/no-explicit-any */
import { PdfBuilder } from './pdf';
import { TAX_LABEL } from '../gst';
import { amountInWords, fmtDate, fmtDateTime, fmtMonth, inr, inr2, num } from '../format';
import { L } from '../slipLabels';
import type { AppSettings } from '../settings';

type Company = AppSettings['company'];

async function letterhead(doc: PdfBuilder, company: Company, right: { text: string; bold?: boolean; size?: number; color?: 'grey' }[]) {
  doc.twoColumns(
    [
      { text: company.name, bold: true, size: 15 },
      ...(company.brand ? [{ text: company.brand, size: 8.5, color: 'grey' as const }] : []),
      { text: [company.address, company.gstin && `GSTIN: ${company.gstin}`, company.state && `State: ${company.state}${company.stateCode ? ` (${company.stateCode})` : ''}`, company.phone].filter(Boolean).join(' · '), size: 8.5 },
    ],
    right,
    doc.contentWidth * 0.58
  );
  doc.space(2);
  doc.rule(1.4);
}

/** Tax invoice, export invoice or quotation: same layout as the on-screen document. */
export async function saleDocument(sale: any, company: Company, kind: 'quotation' | 'invoice') {
  const isQuote = kind === 'quotation' || !sale.invoiceNo;
  const exp = sale.taxType === 'export', igst = sale.taxType === 'igst';
  const title = isQuote ? 'QUOTATION' : exp ? 'EXPORT INVOICE (under LUT)' : 'TAX INVOICE';
  const docNo = isQuote ? sale.saleNo : sale.invoiceNo;
  const docDate = isQuote ? sale.date : sale.invoiceDate || sale.date;
  const doc = await PdfBuilder.create(`${title} ${docNo}`);

  await letterhead(doc, company, [
    { text: title, bold: true, size: 13 },
    { text: String(docNo ?? ''), bold: true, size: 10 },
    { text: `Date: ${fmtDate(docDate)}`, size: 9 },
    ...(isQuote ? [{ text: 'Valid for 15 days', size: 8.5, color: 'grey' as const }] : []),
  ]);

  doc.twoColumns(
    [
      { text: 'BILL TO', size: 7.5, color: 'grey' },
      { text: sale.customerName, bold: true, size: 10 },
      { text: sale.customerAddress, size: 9 },
      { text: [sale.customerState, sale.customerCountry].filter(Boolean).join(', '), size: 9 },
      ...(sale.customerGstin ? [{ text: `GSTIN: ${sale.customerGstin}`, size: 9 }] : []),
      ...(sale.customerMobile ? [{ text: `Mobile: ${sale.customerMobile}`, size: 9 }] : []),
    ],
    [
      { text: 'DETAILS', size: 7.5, color: 'grey' },
      { text: `Order: ${sale.saleNo}`, size: 9 },
      { text: `Place of supply: ${sale.customerState || '—'}`, size: 9 },
      { text: `Tax: ${TAX_LABEL[sale.taxType as keyof typeof TAX_LABEL] ?? sale.taxType}`, size: 9 },
    ],
    doc.contentWidth * 0.55
  );
  doc.space(8);

  const cols: { head: string; w: number; align?: 'left' | 'right' | 'center' }[] = [
    { head: '#', w: 18 }, { head: 'Description', w: 120 }, { head: 'HSN', w: 38, align: 'center' }, { head: 'Qty', w: 40, align: 'right' }, { head: 'Unit', w: 30, align: 'center' },
    { head: 'Rate', w: 52, align: 'right' }, { head: 'Taxable', w: 58, align: 'right' },
  ];
  if (!exp && !igst) cols.push({ head: 'CGST', w: 52, align: 'right' }, { head: 'SGST', w: 52, align: 'right' });
  if (igst) cols.push({ head: 'IGST', w: 60, align: 'right' });
  cols.push({ head: 'Amount', w: 62, align: 'right' });
  const rows = (sale.items ?? []).map((i: any, k: number) => {
    const r: (string | number)[] = [k + 1, i.name, i.hsn ?? '', num(i.qty), i.unit ?? '', inr2(i.rate), inr2(i.amount)];
    if (!exp && !igst) r.push(`${inr2(i.tax / 2)} (${i.gstRate / 2}%)`, `${inr2(i.tax / 2)} (${i.gstRate / 2}%)`);
    if (igst) r.push(`${inr2(i.tax)} (${i.gstRate}%)`);
    r.push(inr2(i.amount + (exp ? 0 : i.tax)));
    return r;
  });
  doc.table(cols, rows, { size: 8 });
  doc.space(8);

  const pending = Math.max(0, (sale.total ?? 0) - (sale.paid || 0));
  const startY = doc.y;
  doc.para('AMOUNT IN WORDS', { size: 7.5, color: 'grey', w: doc.contentWidth * 0.5 });
  doc.para(amountInWords(sale.total), { size: 9, bold: true, w: doc.contentWidth * 0.5 });
  if (exp) doc.para('Supply meant for export under Letter of Undertaking (LUT) without payment of IGST.', { size: 8, w: doc.contentWidth * 0.5 });
  if (!isQuote) {
    const bank = [company.bankName, company.bankAccount && `A/c ${company.bankAccount}`, company.ifsc && `IFSC ${company.ifsc}`].filter(Boolean).join(' · ');
    if (bank) doc.para(`Bank details: ${bank}`, { size: 8, w: doc.contentWidth * 0.5 });
  }
  const leftEnd = doc.y;
  doc.y = startY;
  const t: [string, string, boolean?][] = [['Taxable value', inr2(sale.taxable)]];
  if (!exp && !igst) t.push(['CGST', inr2(sale.cgst)], ['SGST', inr2(sale.sgst)]);
  if (igst) t.push(['IGST', inr2(sale.igst)]);
  t.push(['Round off', inr2(sale.roundOff)], ['Total', inr(sale.total), true]);
  if (!isQuote) t.push(['Received', inr(sale.paid)], ['Balance', inr(pending), true]);
  doc.totals(t, { w: doc.contentWidth * 0.42 });
  doc.y = Math.min(doc.y, leftEnd);

  doc.space(12);
  doc.para('Terms', { size: 8.5, bold: true });
  ['Goods once sold will not be taken back; breakage in transit is at buyer’s risk unless insured.', 'Natural stone may vary in shade and texture.', 'Payment as agreed; interest @18% p.a. on overdue.', 'Subject to Bhilwara (Rajasthan) jurisdiction.']
    .forEach((s, i) => doc.para(`${i + 1}. ${s}`, { size: 8, color: 'grey' }));
  doc.space(6);
  doc.para(`For ${company.name}`, { size: 9, bold: true, align: 'right' });
  doc.signatures(['Authorised signatory']);
  return { bytes: await doc.bytes(), filename: `${isQuote ? 'Quotation' : 'Invoice'}-${docNo}.pdf` };
}

/** Salary slip in English or Hindi. */
export async function salarySlipDocument(slip: any, company: Company, lang: 'en' | 'hi') {
  const l = L[lang];
  const r = slip.row;
  const doc = await PdfBuilder.create(`${L.en.title} ${slip.month} ${r.empCode}`);
  await letterhead(doc, company, [{ text: l.title, bold: true, size: 14 }, { text: fmtMonth(slip.month), bold: true, size: 10 }]);

  const payLabel = (l as any)[r.payType] ?? r.payType;
  doc.keyValues([
    [l.emp, r.name], [l.code, r.empCode],
    [l.job, r.job], [l.payType, `${payLabel} · ₹${num(r.rate)}`],
    [r.payType === 'piece' ? l.qty : l.days, r.payType === 'piece' ? `${num(r.qty)} ${r.pieceUnit === 'piece' ? 'pcs' : 'sq ft'}` : r.daysPresent],
    [l.status, r.paid ? `${l.paid} (${r.paidMode}, ${fmtDate(r.paidOn)})` : slip.status],
  ]);
  doc.space(6);
  doc.table([{ head: l.earnings, w: 70 }, { head: '₹', w: 30, align: 'right' }], [[l.wages, inr(r.wages)], [`${l.ot} (${r.otHours} h)`, inr(r.otPay)], [l.gross, inr(r.gross)]], { boldLast: true });
  doc.space(4);
  doc.table([{ head: l.ded, w: 70 }, { head: '₹', w: 30, align: 'right' }], [[l.pf, inr(r.pf)], [l.esi, inr(r.esi)], [l.adv, inr(r.advanceRecovery)]]);
  doc.space(8);
  doc.table([{ head: l.net, w: 70, align: 'left' }, { head: inr(r.net), w: 30, align: 'right' }], []);
  doc.space(6);
  doc.para(`${l.words}: ${amountInWords(r.net)}`, { size: 9 });
  if (r.formula) doc.para(`${l.how}: ${r.formula}`, { size: 8, color: 'grey' });
  doc.space(4);
  doc.para(l.computer, { size: 8, color: 'grey' });
  doc.signatures([l.sign]);
  return { bytes: await doc.bytes(), filename: `Salary-slip-${slip.month}-${r.empCode}.pdf` };
}

/** Gate pass: English only, the way the guard and the driver read it. */
export async function gatePassDocument(d: any, company: Company) {
  const doc = await PdfBuilder.create(`Gate pass ${d.gatePassNo}`);
  const out = d.status === 'out';
  await letterhead(doc, company, [{ text: 'GATE PASS', bold: true, size: 15 }, { text: String(d.gatePassNo ?? ''), bold: true, size: 10 }, { text: fmtDate(d.date), size: 9 }]);
  doc.keyValues([
    ['Customer', d.customerName], ['Order / Invoice', `${d.saleNo || '-'} / ${d.invoiceNo || '-'}`],
    ['Truck number', d.truckNo], ['Driver', `${d.driverName || ''} ${d.driverMobile || ''}`.trim()],
    ['Transporter', d.transporter], ['E-way bill', d.eway],
    ['Weight (kg)', d.loadedWeight ? `Empty ${num(d.emptyWeight)} · Loaded ${num(d.loadedWeight)} · Net ${num(d.netWeight)}` : ''],
    ['Freight', d.freight ? `${inr(d.freight)} (${d.freightPaid ? 'paid' : 'to pay'})` : ''],
  ], { size: 10 });
  doc.space(10);
  doc.table([{ head: 'Material loaded', w: 70 }, { head: 'Quantity', w: 30, align: 'right' }], (d.items ?? []).length ? d.items.map((i: any) => [i.name, `${num(i.qty)} ${i.unit ?? ''}`]) : [['—', '']], { size: 9.5 });
  doc.space(6);
  doc.para(out ? `TRUCK MARKED OUT ${fmtDateTime(d.outAt)}` : 'Not yet marked out by guard', { bold: true, size: 10, align: 'center' });
  doc.signatures(['Dispatch in-charge', 'Driver signature', 'Guard']);
  return { bytes: await doc.bytes(), filename: `Gate-pass-${d.gatePassNo}.pdf` };
}
