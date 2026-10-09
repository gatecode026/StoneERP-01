'use client';
import { useParams } from 'next/navigation';
import { Printer, MessageCircle, LogOut } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApp, useFetch } from '@/components/Providers';
import { PageHeader, SkeletonList, RoleGuard } from '@/components/ui';
import { api, openWA } from '@/lib/client';
import { COMPANY } from '@/lib/config';
import { fmtDate, fmtDateTime, num, inr } from '@/lib/format';

export default function GatePass() {
  const { id } = useParams();
  const { role } = useApp();
  const { data: d, loading, reload } = useFetch(`/api/dispatches/${id}`);
  if (loading || !d) return <SkeletonList />;
  const out = d.status === 'out';
  const msg = `Dear ${d.customerName}, your order ${d.saleNo || ''} has left our Bijoliya factory.\nTruck: ${d.truckNo}\nDriver: ${d.driverName || '-'} ${d.driverMobile || ''}\nInvoice: ${d.invoiceNo || '-'}\nE-way bill: ${d.eway || '-'}\n— ${COMPANY.name}`;
  async function markOut() {
    try { await api(`/api/dispatches/${id}`, { method: 'PATCH', body: { status: 'out' } }); toast.success('Truck marked out – stock deducted'); reload(); } catch (e) { toast.error(e.message); }
  }
  const Row = ({ k, v }) => <tr><td className="py-1.5 pr-4 text-gray-500 w-40 align-top">{k}</td><td className="py-1.5 font-medium">{v || '—'}</td></tr>;
  return (
    <RoleGuard perm="dispatch">
      <PageHeader title={`Gate pass ${d.gatePassNo}`} back="/dispatch" actions={<>
        {!out && ['owner', 'manager', 'supervisor', 'accountant'].includes(role) && <button className="btn-primary" onClick={markOut}><LogOut size={16} /> Guard: mark truck out</button>}
        {out && <button className="btn-green" onClick={() => openWA(msg, d.customerMobile)}><MessageCircle size={16} /> Tell customer</button>}
        <button className="btn-outline" onClick={() => window.print()}><Printer size={16} /> Print</button>
      </>} />
      <div className="print-doc card max-w-2xl mx-auto p-6">
        <div className="flex justify-between items-start border-b-2 border-black pb-3">
          <div><div className="text-xl font-bold">{COMPANY.name}</div><div className="text-xs text-gray-600">{COMPANY.address}<br />GSTIN: {COMPANY.gstin}</div></div>
          <div className="text-right"><div className="text-2xl font-extrabold tracking-wide">GATE PASS</div><div className="font-bold">{d.gatePassNo}</div><div className="text-xs">{fmtDate(d.date)}</div></div>
        </div>
        <table className="w-full text-sm mt-4"><tbody>
          <Row k="Customer" v={d.customerName} />
          <Row k="Order / Invoice" v={`${d.saleNo || '-'} / ${d.invoiceNo || '-'}`} />
          <Row k="Truck number" v={<span className="text-lg font-bold">{d.truckNo}</span>} />
          <Row k="Driver" v={`${d.driverName || ''} ${d.driverMobile || ''}`} />
          <Row k="Transporter" v={d.transporter} />
          <Row k="E-way bill" v={d.eway} />
          <Row k="Weight (kg)" v={d.loadedWeight ? `Empty ${num(d.emptyWeight)} · Loaded ${num(d.loadedWeight)} · Net ${num(d.netWeight)}` : ''} />
          <Row k="Freight" v={d.freight ? `${inr(d.freight)} (${d.freightPaid ? 'paid' : 'to pay'})` : ''} />
        </tbody></table>
        <div className="mt-4 border border-gray-300 rounded">
          <div className="bg-gray-100 px-3 py-1.5 text-xs font-bold uppercase">Material loaded</div>
          {(d.items || []).map((i, k) => <div key={k} className="px-3 py-2 border-t text-sm flex justify-between"><span>{i.name}</span><b>{num(i.qty)} {i.unit}</b></div>)}
          {!(d.items || []).length && <div className="px-3 py-2 text-sm text-gray-500">—</div>}
        </div>
        {(d.photoLoaded || d.photoCovered) && (
          <div className="mt-4 grid grid-cols-2 gap-3 no-print">
            {[['Loaded truck', d.photoLoaded], ['Covered truck', d.photoCovered]].map(([l, p]) => p && (
              <div key={l}><div className="text-xs text-gray-500 mb-1">{l}</div>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={p} alt={l} className="rounded border w-full" /></div>
            ))}
          </div>
        )}
        <div className="mt-8 grid grid-cols-3 gap-4 text-xs text-center">
          <div className="pt-8 border-t border-black">Dispatch in-charge</div>
          <div className="pt-8 border-t border-black">Driver signature</div>
          <div className="pt-8 border-t border-black">Guard {out ? `· OUT ${fmtDateTime(d.outAt)}` : ''}</div>
        </div>
        <div className={`mt-4 text-center text-sm font-bold ${out ? 'text-emerald-700' : 'text-amber-700'}`}>{out ? '✔ TRUCK MARKED OUT' : 'Not yet marked out by guard'}</div>
      </div>
    </RoleGuard>
  );
}
