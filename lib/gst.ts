// GST maths in integer paise so CGST + SGST always add up to the exact tax and the invoice total never drifts.
export const HSN_OPTIONS = [
  { value: '6802', label: '6802 – Worked monumental / building stone (18%)', rate: 18 },
  { value: '2516', label: '2516 – Sandstone, in blocks / rough (5%)', rate: 5 },
];
export type TaxType = 'cgst_sgst' | 'igst' | 'export';
export type Company = { state: string; stateCode: string };

export const TAX_LABEL: Record<TaxType, string> = {
  cgst_sgst: 'CGST + SGST (intra-state)',
  igst: 'IGST (inter-state)',
  export: 'Export under LUT (no GST)',
};

const norm = (s: string | undefined | null) => String(s ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');

/** Place of supply: GSTIN state code when the customer has a GSTIN, otherwise the state name; blank = same state. */
export function taxTypeFor(customer: { country?: string; state?: string; gstin?: string } | null | undefined, company: Company = { state: 'Rajasthan', stateCode: '08' }): TaxType {
  if (!customer) return 'cgst_sgst';
  const country = norm(customer.country || 'India');
  if (country !== 'india') return 'export';
  const gst = String(customer.gstin ?? '').trim();
  if (/^\d{2}/.test(gst)) return gst.slice(0, 2) === company.stateCode ? 'cgst_sgst' : 'igst';
  const st = norm(customer.state);
  if (!st) return 'cgst_sgst';
  return st === norm(company.state) ? 'cgst_sgst' : 'igst';
}

export type LineIn = { qty?: number | string; rate?: number | string; gstRate?: number | string; [k: string]: unknown };
const p = (rupees: number) => Math.round(rupees * 100); // to paise
const r = (paise: number) => paise / 100;

export function computeTotals<T extends LineIn>(items: T[] = [], taxType: TaxType = 'cgst_sgst') {
  let taxablePaise = 0;
  let taxPaise = 0;
  const rows = items.map((it) => {
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const amountP = Math.round(qty * rate * 100);
    const gstRate = taxType === 'export' ? 0 : Number(it.gstRate ?? 18) || 0;
    const taxP = Math.round((amountP * gstRate) / 100);
    taxablePaise += amountP;
    taxPaise += taxP;
    return { ...it, qty, rate, amount: r(amountP), gstRate, tax: r(taxP) };
  });
  const half = Math.floor(taxPaise / 2);
  const cgstP = taxType === 'cgst_sgst' ? half : 0;
  const sgstP = taxType === 'cgst_sgst' ? taxPaise - half : 0; // the odd paisa goes to SGST
  const igstP = taxType === 'igst' ? taxPaise : 0;
  const rawP = taxablePaise + cgstP + sgstP + igstP;
  const totalRupees = Math.round(rawP / 100);
  return {
    rows, taxable: r(taxablePaise), cgst: r(cgstP), sgst: r(sgstP), igst: r(igstP), totalTax: r(taxPaise),
    roundOff: r(totalRupees * 100 - rawP), total: totalRupees,
  };
}
export { p as toPaise };
