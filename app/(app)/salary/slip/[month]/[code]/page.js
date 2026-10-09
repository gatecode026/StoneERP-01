'use client';
import { useParams } from 'next/navigation';
import { Printer, MessageCircle } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, SkeletonList, Empty } from '@/components/ui';
import { openWA } from '@/lib/client';
import { COMPANY, SALARY } from '@/lib/config';
import { inr, fmtMonth, num, amountInWords, fmtDate, todayISO } from '@/lib/format';

const L = {
  en: { title: 'SALARY SLIP', emp: 'Employee', code: 'Code', job: 'Job', payType: 'Pay type', days: 'Days present', qty: 'Quantity', earnings: 'Earnings', wages: 'Wages', ot: 'Overtime', gross: 'Gross', ded: 'Deductions', pf: 'PF', esi: 'ESI', adv: 'Advance recovery', net: 'NET SALARY', words: 'Amount in words', how: 'How wages were worked out', paid: 'Paid', status: 'Status', monthly: 'Monthly', daily: 'Daily', piece: 'Piece rate', sign: 'Authorised signatory', computer: 'This is a computer-generated slip.' },
  hi: { title: 'वेतन पर्ची', emp: 'कर्मचारी', code: 'कोड', job: 'काम', payType: 'वेतन का प्रकार', days: 'उपस्थित दिन', qty: 'मात्रा', earnings: 'कमाई', wages: 'मज़दूरी / वेतन', ot: 'ओवरटाइम', gross: 'कुल कमाई', ded: 'कटौती', pf: 'पीएफ', esi: 'ईएसआई', adv: 'एडवांस कटौती', net: 'शुद्ध वेतन', words: 'राशि शब्दों में', how: 'वेतन कैसे बना', paid: 'भुगतान', status: 'स्थिति', monthly: 'मासिक', daily: 'दैनिक', piece: 'पीस रेट', sign: 'अधिकृत हस्ताक्षर', computer: 'यह कंप्यूटर द्वारा बनाई गई पर्ची है।' },
};

export default function Slip() {
  const { month, code } = useParams();
  const { lang, setLang, role } = useApp();
  const { data, loading } = useFetch(`/api/salary?month=${month}&empCode=${code}`);
  const l = L[lang];
  if (loading) return <SkeletonList />;
  const r = data?.rows?.[0];
  if (!r) return <RoleGuard perm="salary"><Empty text="No salary data for this employee and month" /></RoleGuard>;
  const msg = `*${L.en.title} – ${fmtMonth(month)}*\n${r.name} (${r.empCode})\nWages ${inr(r.wages)}${r.otPay ? ` + OT ${inr(r.otPay)}` : ''}\nPF/ESI ${inr(r.pf + r.esi)} · Advance ${inr(r.advanceRecovery)}\n*Net salary: ${inr(r.net)}*\n— ${COMPANY.name}`;
  const Row = ({ a, b, bold }) => <div className={`flex justify-between py-1.5 border-b border-gray-200 ${bold ? 'font-bold' : ''}`}><span>{a}</span><span>{b}</span></div>;
  return (
    <RoleGuard perm="salary">
      <PageHeader title={l.title} back="/salary" actions={<>
        <button className="btn-outline" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{lang === 'en' ? 'हिन्दी' : 'English'}</button>
        <button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> Print / PDF</button>
        {role !== 'worker' && <button className="btn-green" onClick={() => openWA(msg, r.mobile)}><MessageCircle size={16} /> WhatsApp</button>}
      </>} />
      <div className="print-doc card max-w-2xl mx-auto p-6 text-sm">
        <div className="flex justify-between items-start border-b-2 border-black pb-3">
          <div><div className="text-lg font-extrabold">{COMPANY.name}</div><div className="text-xs text-gray-600">{COMPANY.address}</div></div>
          <div className="text-right"><div className="text-xl font-extrabold">{l.title}</div><div className="font-bold">{fmtMonth(month)}</div></div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 py-3 border-b border-gray-300">
          <div><span className="text-gray-500">{l.emp}:</span> <b>{r.name}</b></div><div><span className="text-gray-500">{l.code}:</span> {r.empCode}</div>
          <div><span className="text-gray-500">{l.job}:</span> {r.job}</div><div><span className="text-gray-500">{l.payType}:</span> {l[r.payType]} · ₹{num(r.rate)}</div>
          <div><span className="text-gray-500">{r.payType === 'piece' ? l.qty : l.days}:</span> {r.payType === 'piece' ? `${num(r.qty)} ${r.pieceUnit === 'piece' ? 'pcs' : 'sq ft'}` : r.daysPresent}</div>
          <div><span className="text-gray-500">{l.status}:</span> {r.paid ? `${l.paid} (${r.paidMode}, ${fmtDate(r.paidOn)})` : data.status}</div>
        </div>
        <div className="grid md:grid-cols-2 gap-6 mt-3">
          <div><div className="font-bold text-xs uppercase text-gray-500 mb-1">{l.earnings}</div>
            <Row a={l.wages} b={inr(r.wages)} /><Row a={`${l.ot} (${r.otHours} h)`} b={inr(r.otPay)} /><Row a={l.gross} b={inr(r.gross)} bold /></div>
          <div><div className="font-bold text-xs uppercase text-gray-500 mb-1">{l.ded}</div>
            <Row a={l.pf} b={inr(r.pf)} /><Row a={l.esi} b={inr(r.esi)} /><Row a={l.adv} b={inr(r.advanceRecovery)} /></div>
        </div>
        <div className="mt-4 bg-gray-100 rounded p-3 flex justify-between items-center"><span className="font-bold">{l.net}</span><span className="text-2xl font-extrabold">{inr(r.net)}</span></div>
        <div className="text-xs mt-2"><b>{l.words}:</b> {amountInWords(r.net)}</div>
        <div className="text-xs mt-3 text-gray-600"><b>{l.how}:</b> {r.formula}</div>
        <div className="mt-10 flex justify-between text-xs text-gray-500 items-end"><span>{l.computer}</span><span className="border-t border-black pt-1 px-6 text-black">{l.sign}</span></div>
      </div>
    </RoleGuard>
  );
}
