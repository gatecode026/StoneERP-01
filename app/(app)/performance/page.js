'use client';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Trophy, MessageSquare } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, DataList, Section, Badge, Sheet, Field, KV, ExportBtn, Pagination } from '@/components/ui';
import { api, downloadCSV } from '@/lib/client';
import { todayISO, monthOf, fmtMonth, num } from '@/lib/format';

const tone = (s) => (s >= 80 ? 'green' : s >= 60 ? 'amber' : 'red');

export default function PerformancePage() {
  const { t, can } = useApp();
  const [month, setMonth] = useState(monthOf(todayISO()));
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  useEffect(() => { setPage(1); }, [month, size]);
  // ranking and the best-five cards cover everybody; the table is one page at a time (server side)
  const { data, loading, reload } = useFetch(`/api/performance?month=${month}&page=${page}&limit=${size}`);
  const [sel, setSel] = useState(null);
  const [remark, setRemark] = useState('');
  const canRemark = can('perfremarks', 'create');
  const rows = data?.rows || [];

  async function saveRemark() {
    try {
      if (sel.remarkId) await api(`/api/perfremarks/${sel.remarkId}`, { method: 'PATCH', body: { remark } });
      else await api('/api/perfremarks', { method: 'POST', body: { month, empCode: sel.empCode, remark } });
      toast.success('Remark saved'); setSel(null); reload();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <RoleGuard perm="performance">
      <PageHeader title={t('performance')} subtitle="Monthly scorecard from what was already entered"
        actions={<><input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value || month)} />{rows.length > 0 && <ExportBtn onClick={async () => { try { const all = await api(`/api/performance?month=${month}&all=1`); downloadCSV(`performance-${month}`, all.rows, [{ key: 'name', label: 'Name' }, { key: 'job', label: 'Job' }, { key: 'presentDays', label: 'Days present' }, { key: 'absent', label: 'Absent' }, { key: 'onTime', label: 'Reports on time' }, { key: 'qty', label: 'Output' }, { key: 'breakdowns', label: 'Breakdowns' }, { key: 'score', label: 'Score' }, { key: 'remark', label: 'Owner remark' }]); } catch (e) { toast.error(e.message); } }} />}</>} />
      <Section title={<span className="flex items-center gap-2"><Trophy size={16} className="text-terra" /> Best workers – {fmtMonth(month)}</span>} className="mb-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {(data?.top || []).map((r, i) => (
            <div key={r.empCode} className={`rounded-xl p-3 border ${i === 0 ? 'bg-terra-50 border-terra-100' : 'bg-sand-50 border-sand-200'}`}>
              <div className="text-[11px] font-bold text-char-500">#{i + 1}</div>
              <div className="font-bold text-sm truncate">{r.name}</div>
              <div className="text-xs text-char-500 truncate">{r.job}</div>
              <div className="text-2xl font-extrabold text-terra mt-1">{r.score}</div>
            </div>
          ))}
          {!(data?.top || []).length && !loading && <div className="text-sm text-char-500 col-span-full">No data for this month</div>}
        </div>
      </Section>
      <DataList loading={loading} rows={rows} rowKey="empCode" onRowClick={(r) => { setSel(r); setRemark(r.remark || ''); }} columns={[
        { key: 'name', label: 'Employee', primary: true, render: (r) => <span>{r.name}<div className="text-[11px] text-char-500 font-normal">{r.job}</div></span> },
        { key: 'score', label: 'Score', align: 'right', render: (r) => <Badge tone={tone(r.score)} className="!text-sm">{r.score}</Badge> },
        { key: 'presentDays', label: 'Present / absent', render: (r) => `${r.presentDays} / ${r.absent}` },
        { key: 'reports', label: 'Reports on time', render: (r) => `${r.onTime} of ${data?.workingDays}` },
        { key: 'qty', label: 'Output', render: (r) => (r.qty ? `${num(r.qty)} sq ft` : r.tasks ? `${r.tasksDone}/${r.tasks} tasks` : '—') },
        { key: 'breakdowns', label: 'Breakdowns', render: (r) => r.breakdowns || '—' },
        { key: 'remark', label: 'Owner remark', wide: true, render: (r) => r.remark || <span className="text-char-300">—</span> },
      ]} />
      <Pagination page={page} pageSize={size} total={data?.total} shown={rows.length} onPage={setPage} onSize={setSize} />
      <p className="text-[11px] text-char-500 mt-4">Score (0–100) = attendance 35% (late counts ¼ day less) + daily reports on time 25% + work done 30% (sq ft vs best in the same job, or tasks done) + discipline 10% (−30 for each breakdown while operating or complaint linked to the person).</p>
      <Sheet open={!!sel} onClose={() => setSel(null)} title={`${sel?.name} – ${fmtMonth(month)}`}
        footer={canRemark ? <><button className="btn-outline flex-1" onClick={() => setSel(null)}>Close</button><button className="btn-primary flex-[2]" onClick={saveRemark}>Save remark</button></> : <button className="btn-outline flex-1" onClick={() => setSel(null)}>Close</button>}>
        {sel && <>
          <div className="text-center mb-3"><div className="text-5xl font-extrabold text-terra">{sel.score}</div><div className="text-xs text-char-500">out of 100</div></div>
          <KV label="Attendance score">{sel.attScore}</KV><KV label="Days present / absent / late">{sel.presentDays} / {sel.absent} / {sel.late}</KV>
          <KV label="Daily reports on time">{sel.onTime} of {data?.workingDays} ({sel.repScore})</KV><KV label="Work score">{sel.workScore}</KV>
          <KV label="Output">{num(sel.qty)} sq ft</KV><KV label="Tasks done">{sel.tasksDone} / {sel.tasks}</KV><KV label="Breakdowns while operating">{sel.breakdowns}</KV><KV label="Complaints linked">{sel.complaints}</KV>
          <Field label="Owner remark" className="mt-4"><textarea className="input" rows={3} value={remark} disabled={!canRemark} onChange={(e) => setRemark(e.target.value)} placeholder="Short remark on this scorecard" /></Field>
        </>}
      </Sheet>
    </RoleGuard>
  );
}
