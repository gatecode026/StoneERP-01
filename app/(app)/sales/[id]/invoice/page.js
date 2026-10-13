'use client';
import { useParams, useSearchParams } from 'next/navigation';
import { Printer, MessageCircle, Download } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, SkeletonList } from '@/components/ui';
import { openWA } from '@/lib/client';
import { TAX_LABEL } from '@/lib/gst';
import { amountInWords, fmtDate, inr, inr2, num2, num } from '@/lib/format';

export default function Invoice() {
  const { id } = useParams();
  const sp = useSearchParams();
  const company = useApp().session.company;
  const { data: s, loading } = useFetch(`/api/sales/${id}`);
  if (loading || !s) return <SkeletonList />;
  const isQuote = sp.get('type') === 'quotation' || !s.invoiceNo;
  const docTitle = isQuote ? 'QUOTATION' : s.taxType === 'export' ? 'EXPORT INVOICE (under LUT)' : 'TAX INVOICE';
  const docNo = isQuote ? s.saleNo : s.invoiceNo;
  const docDate = isQuote ? s.date : s.invoiceDate || s.date;
  const exp = s.taxType === 'export';
  const igst = s.taxType === 'igst';
  const pending = Math.max(0, s.total - (s.paid || 0));
  const link = typeof window !== 'undefined' ? location.href : '';
  const msg = isQuote
    ? `*Quotation ${s.saleNo}* – ${company.name}\n${(s.items || []).map((i) => `• ${i.name}: ${i.qty} ${i.unit} × ₹${i.rate}`).join('\n')}\nTotal ${inr(s.total)}\n${link}`
    : `*${exp ? 'Export Invoice' : 'GST Invoice'} ${s.invoiceNo}* – ${company.name}\nAmount ${inr(s.total)} · Balance ${inr(pending)}\n${link}`;
  const cols = exp ? 7 : igst ? 9 : 10;

  return (
    <RoleGuard perm="sales">
      <PageHeader title={docTitle} back={`/sales/${id}`} actions={<>
        <button className="btn-primary" onClick={() => window.print()}><Download size={16} /> Download PDF</button>
        <button className="btn-outline" onClick={() => window.print()}><Printer size={16} /> Print</button>
        <button className="btn-green" onClick={() => openWA(msg, s.customerMobile)}><MessageCircle size={16} /> Share on WhatsApp</button>
      </>} />
      <p className="text-xs text-char-500 mb-2 no-print">Tip: in the print window choose “Save as PDF”.</p>
      <div className="print-doc card max-w-4xl mx-auto p-5 md:p-8 text-[13px] overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="flex justify-between items-start border-b-2 border-black pb-3">
            <div>
              <div className="text-xl font-extrabold">{company.name}</div>
              <div className="text-xs text-gray-600">{company.brand}</div>
              <div className="text-xs mt-1">{company.address}<br />GSTIN: {company.gstin} · State: {company.state} ({company.stateCode}) · {company.phone}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-extrabold tracking-wide">{docTitle}</div>
              <div className="font-bold">{docNo}</div><div className="text-xs">Date: {fmtDate(docDate)}</div>
              {isQuote && <div className="text-xs">Valid for 15 days</div>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 py-3 border-b border-gray-300">
            <div><div className="text-[11px] uppercase text-gray-500 font-bold">Bill to</div>
              <div className="font-bold">{s.customerName}</div><div>{s.customerAddress}</div>
              <div>{[s.customerState, s.customerCountry].filter(Boolean).join(', ')}</div>
              {s.customerGstin && <div>GSTIN: {s.customerGstin}</div>}{s.customerMobile && <div>Mobile: {s.customerMobile}</div>}</div>
            <div className="text-right"><div className="text-[11px] uppercase text-gray-500 font-bold">Details</div>
              <div>Order: {s.saleNo}</div><div>Place of supply: {s.customerState || '—'}</div>
              <div>Tax: {TAX_LABEL[s.taxType]}</div>{!isQuote && <div>E-way bill: as per dispatch</div>}</div>
          </div>

          <table className="w-full mt-3 border border-gray-300 text-[12px]">
            <thead><tr className="bg-gray-100">
              <th className="border border-gray-300 p-1.5 text-left">#</th><th className="border border-gray-300 p-1.5 text-left">Description</th><th className="border border-gray-300 p-1.5">HSN</th>
              <th className="border border-gray-300 p-1.5 text-right">Qty</th><th className="border border-gray-300 p-1.5">Unit</th><th className="border border-gray-300 p-1.5 text-right">Rate</th><th className="border border-gray-300 p-1.5 text-right">Taxable</th>
              {!exp && !igst && <><th className="border border-gray-300 p-1.5 text-right">CGST</th><th className="border border-gray-300 p-1.5 text-right">SGST</th></>}
              {igst && <th className="border border-gray-300 p-1.5 text-right">IGST</th>}
              <th className="border border-gray-300 p-1.5 text-right">Amount</th>
            </tr></thead>
            <tbody>
              {(s.items || []).map((i, k) => (
                <tr key={k}>
                  <td className="border border-gray-300 p-1.5">{k + 1}</td><td className="border border-gray-300 p-1.5">{i.name}</td><td className="border border-gray-300 p-1.5 text-center">{i.hsn}</td>
                  <td className="border border-gray-300 p-1.5 text-right">{num(i.qty)}</td><td className="border border-gray-300 p-1.5 text-center">{i.unit}</td><td className="border border-gray-300 p-1.5 text-right">{inr2(i.rate)}</td><td className="border border-gray-300 p-1.5 text-right">{inr2(i.amount)}</td>
                  {!exp && !igst && <><td className="border border-gray-300 p-1.5 text-right">{inr2(i.tax / 2)}<div className="text-[10px] text-gray-500">{i.gstRate / 2}%</div></td><td className="border border-gray-300 p-1.5 text-right">{inr2(i.tax / 2)}<div className="text-[10px] text-gray-500">{i.gstRate / 2}%</div></td></>}
                  {igst && <td className="border border-gray-300 p-1.5 text-right">{inr2(i.tax)}<div className="text-[10px] text-gray-500">{i.gstRate}%</div></td>}
                  <td className="border border-gray-300 p-1.5 text-right font-semibold">{inr2(i.amount + (exp ? 0 : i.tax))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid grid-cols-2 gap-4 mt-3">
            <div>
              <div className="text-[11px] uppercase text-gray-500 font-bold">Amount in words</div>
              <div className="font-semibold">{amountInWords(s.total)}</div>
              {exp && <div className="text-xs mt-2">Supply meant for export under Letter of Undertaking (LUT) without payment of IGST.</div>}
              {!isQuote && <div className="text-xs mt-3"><b>Bank details:</b> {[company.bankName, company.bankAccount && `A/c ${company.bankAccount}`, company.ifsc && `IFSC ${company.ifsc}`].filter(Boolean).join(' · ')}</div>}
            </div>
            <table className="text-sm self-start ml-auto w-full max-w-xs"><tbody>
              <tr><td className="py-0.5">Taxable value</td><td className="text-right">{inr2(s.taxable)}</td></tr>
              {!exp && !igst && <><tr><td className="py-0.5">CGST</td><td className="text-right">{inr2(s.cgst)}</td></tr><tr><td className="py-0.5">SGST</td><td className="text-right">{inr2(s.sgst)}</td></tr></>}
              {igst && <tr><td className="py-0.5">IGST</td><td className="text-right">{inr2(s.igst)}</td></tr>}
              <tr><td className="py-0.5">Round off</td><td className="text-right">{inr2(s.roundOff)}</td></tr>
              <tr className="border-t-2 border-black font-extrabold text-base"><td className="py-1">Total</td><td className="text-right">{inr(s.total)}</td></tr>
              {!isQuote && <><tr><td className="py-0.5">Received</td><td className="text-right">{inr(s.paid)}</td></tr><tr className="font-bold"><td className="py-0.5">Balance</td><td className="text-right">{inr(pending)}</td></tr></>}
            </tbody></table>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-6 text-xs">
            <div><b>Terms:</b><ol className="list-decimal pl-4 mt-1 text-gray-600"><li>Goods once sold will not be taken back; breakage in transit is at buyer’s risk unless insured.</li><li>Natural stone may vary in shade and texture.</li><li>Payment as agreed; interest @18% p.a. on overdue.</li><li>Subject to Bhilwara (Rajasthan) jurisdiction.</li></ol></div>
            <div className="text-right"><div>For <b>{company.name}</b></div><div className="h-12" /><div className="border-t border-black inline-block pt-1 px-6">Authorised signatory</div></div>
          </div>
        </div>
      </div>
    </RoleGuard>
  );
}
