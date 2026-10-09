import { COMPANY } from './config';

export const HSN_OPTIONS = [
  { value: '6802', label: '6802 – Worked monumental / building stone (18%)', rate: 18 },
  { value: '2516', label: '2516 – Sandstone, in blocks / rough (5%)', rate: 5 },
];

export function taxTypeFor(customer) {
  if (!customer) return 'cgst_sgst';
  const country = (customer.country || 'India').toLowerCase();
  if (country !== 'india') return 'export';
  const state = (customer.state || COMPANY.state).toLowerCase();
  return state === COMPANY.state.toLowerCase() ? 'cgst_sgst' : 'igst';
}

export const TAX_LABEL = {
  cgst_sgst: 'CGST + SGST (intra-state)',
  igst: 'IGST (inter-state)',
  export: 'Export under LUT (no GST)',
};

export function computeTotals(items = [], taxType = 'cgst_sgst') {
  const rows = items.map((it) => {
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const amount = Math.round(qty * rate * 100) / 100;
    const gstRate = taxType === 'export' ? 0 : Number(it.gstRate ?? 18) || 0;
    const tax = Math.round(amount * gstRate) / 100;
    return { ...it, qty, rate, amount, gstRate, tax };
  });
  const taxable = rows.reduce((a, r) => a + r.amount, 0);
  const totalTax = rows.reduce((a, r) => a + r.tax, 0);
  const cgst = taxType === 'cgst_sgst' ? totalTax / 2 : 0;
  const sgst = cgst;
  const igst = taxType === 'igst' ? totalTax : 0;
  const raw = taxable + cgst + sgst + igst;
  const total = Math.round(raw);
  return { rows, taxable, cgst, sgst, igst, totalTax, roundOff: Math.round((total - raw) * 100) / 100, total };
}
