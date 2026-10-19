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

/** GST state codes (the first two digits of a GST number) and the state they stand for. */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};
export const STATE_NAMES: string[] = Object.values(GST_STATES);
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
/** The state's proper name for what was typed ("rajasthan", "Rajsthan " is not matched), or '' when it is not a state. */
export const canonicalState = (v: unknown): string => STATE_NAMES.find((n) => lower(n) === lower(v)) ?? '';
/** The state a GST number belongs to, or '' when the number does not start with a state code. */
export const stateOfGstin = (g: unknown): string => GST_STATES[String(g ?? '').trim().slice(0, 2)] ?? '';

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
