/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { buildTally } from '@/lib/export/tally';

// every voucher must add up to zero: debits (negative) + credits (positive)
function balances(xml: string) {
  return [...xml.matchAll(/<VOUCHER [^>]*>(.*?)<\/VOUCHER>/g)].map((m) => [...m[1].matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].reduce((a, x) => a + Number(x[1]), 0));
}

const sale = { saleNo: 'S-1', invoiceNo: 'VSS/26-27/0001', invoiceDate: '2026-10-14', customerName: 'Delhi Builders & Co', taxable: 1000, cgst: 90, sgst: 90, igst: 0, roundOff: -0.4, total: 1179.6 };

describe('Tally export', () => {
  it('writes balanced vouchers with Tally signs, and ledgers before vouchers', () => {
    const { xml, counts, skipped } = buildTally({
      company: 'Vipul Stone Suppliers',
      sales: [sale, { ...sale, invoiceNo: 'VSS/26-27/0002', taxable: 2000, cgst: 0, sgst: 0, igst: 360, roundOff: 0.2, total: 2360.2 }],
      purchases: [{ _id: 'abc12345678', date: '2026-10-10', supplierName: 'Kota Quarry', itemName: 'Blocks', qty: 4, gstPercent: 18, total: 11800, billNo: 'KQ/77' }],
      payments: [{ _id: 'pay00000001', date: '2026-10-15', customerName: 'Delhi Builders & Co', amount: 500, mode: 'UPI', saleNo: 'S-1' }, { _id: 'pay00000002', date: '2026-10-15', customerName: 'Delhi Builders & Co', amount: 100, mode: 'Cash' }],
      expenses: [{ _id: 'exp00000001', date: '2026-10-16', head: 'Diesel', amount: 2500, paidBy: 'Cash', paidTo: 'Pump' }],
    });
    expect(skipped).toEqual([]);
    expect(counts).toEqual({ sales: 2, purchases: 1, receipts: 2, payments: 1 });
    const sums = balances(xml);
    expect(sums).toHaveLength(6);
    for (const s of sums) expect(Math.abs(s)).toBeLessThan(0.005);
    // the customer is debited (deemed positive, negative amount), Sales credited
    expect(xml).toContain('<LEDGERNAME>Delhi Builders &amp; Co</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1179.60</AMOUNT>');
    expect(xml).toContain('<LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1000.00</AMOUNT>');
    expect(xml).toContain('<LEDGERNAME>Round Off</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-0.40</AMOUNT>'); // a negative round-off is a debit
    expect(xml).toContain('<DATE>20261014</DATE>');
    expect(xml).toContain('<LEDGERNAME>Input GST</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1800.00</AMOUNT>'); // 11,800 = 10,000 + 1,800
    expect(xml).toContain('<LEDGERNAME>Cash</LEDGERNAME>'); // the cash receipt and the cash expense
    expect(xml).toContain('<LEDGERNAME>Bank Account</LEDGERNAME>'); // UPI is a bank receipt
    // ledgers (masters) come before the first voucher; party ledgers get the right group
    expect(xml.indexOf('<LEDGER NAME="Delhi Builders &amp; Co"')).toBeGreaterThan(-1);
    expect(xml.indexOf('<LEDGER ')).toBeLessThan(xml.indexOf('<VOUCHER '));
    expect(xml).toContain('<PARENT>Sundry Debtors</PARENT>');
    expect(xml).toContain('<PARENT>Sundry Creditors</PARENT>');
    expect(xml).toContain('<SVCURRENTCOMPANY>Vipul Stone Suppliers</SVCURRENTCOMPANY>');
  });

  it('skips a record whose amounts do not add up instead of writing a voucher Tally would reject', () => {
    const { xml, counts, skipped } = buildTally({ company: 'X', sales: [{ ...sale, total: 5000 }], expenses: [{ _id: 'e1', date: '2026-10-16', head: '', amount: 10, paidBy: 'Cash' }] });
    expect(counts).toEqual({ sales: 0, purchases: 0, receipts: 0, payments: 0 });
    expect(skipped).toHaveLength(2);
    expect(xml).not.toContain('<VOUCHER ');
  });

  it('XML-escapes names and removes characters XML cannot hold', () => {
    const bell = String.fromCharCode(7);
    const { xml } = buildTally({ company: 'A<B', sales: [{ ...sale, customerName: `Raj "Stone" <Ltd>${bell}` }] });
    expect(xml).toContain('Raj &quot;Stone&quot; &lt;Ltd&gt;');
    expect(xml).not.toContain(bell);
    expect(xml).toContain('A&lt;B');
  });
});
