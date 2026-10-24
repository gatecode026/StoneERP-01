'use client';
import ImportData from '@/components/ImportData';
import { useEffect, useState } from 'react';
import toast from '@/lib/toast';
import { Trophy, MessageSquare } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, DataList, Section, Badge, Sheet, Field, KV, ExportBtn, Pagination } from '@/components/ui';
import { api, downloadCSV } from '@/lib/client';
import { todayISO, monthOf, fmtMonth, num } from '@/lib/format';
import T from '@/components/T';

const tone = (s) => (s >= 80 ? 'green' : s >= 60 ? 'amber' : 'red');
// detect duplicate names in the result set
const findDupes = (rows) => { const seen = {}; rows.forEach((r) => { seen[r.name] = (seen[r.name] || 0) + 1; }); return Object.keys(seen).filter((n) => seen[n] > 1); };

export default function PerformancePage() {
  const { t, tr, can } = useApp();
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
  const dupes = findDupes(rows);

  async function saveRemark() {
    try {
      if (sel.remarkId) await api(`/api/perfremarks/${sel.remarkId}`, { method: 'PATCH', body: { remark } });
      else await api('/api/perfremarks', { method: 'POST', body: { month, empCode: sel.empCode, remark } });
      toast.success('Remark saved'); setSel(null); reload();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <RoleGuard perm="performance">
      {dupes.length > 0 && (
        <div className="mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
          ⚠️ <b>Duplicate employees detected:</b> {dupes.join(', ')} — these appear more than once because the import ran twice. Deactivate the duplicate records from the Employees page.
        </div>
      )}
      <PageHeader title={t('performance')} subtitle="Monthly scorecard — employees need 3+ days data to receive a score"
        actions={<><ImportData resource="perfremarks" perm="perfremarks" noun="performance remarks" /><input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value || month)} />{can('performance', 'export') && rows.length > 0 && <ExportBtn onClick={async () => { try { const all = await api(`/api/performance?month=${month}&all=1`); downloadCSV(`performance-${month}`, all.rows, [{ key: 'name', label: 'Name' }, { key: 'job', label: 'Job' }, { key: 'presentDays', label: 'Days present' }, { key: 'absent', label: 'Absent' }, { key: 'onTime', label: 'Reports on time' }, { key: 'qty', label: 'Output' }, { key: 'breakdowns', label: 'Breakdowns' }, { key: 'score', label: 'Score' }, { key: 'remark', label: 'Owner remark' }]); } catch (e) { toast.error(e.message); } }} />}</>} />
      <Section title={<span className="flex items-center gap-2"><Trophy size={16} className="text-terra" /> <T vars={{ m: fmtMonth(month) }}>{'Best workers – {m}'}</T></span>} className="mb-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {(data?.top || []).filter((r) => r.hasData && r.score > 0).slice(0, 5).map((r, i) => (
            <div key={r.empCode} className={`rounded-xl p-3 border ${i === 0 ? 'bg-terra-50 border-terra-100' : 'bg-sand-50 border-sand-200'}`}>
              <div className="text-[11px] font-bold text-char-500">#{i + 1}</div>
              <div className="font-bold text-sm truncate">{r.name}</div>
              <div className="text-xs text-char-500 truncate">{r.job}</div>
              <div className="text-2xl font-extrabold text-terra mt-1">{r.score}</div>
            </div>
          ))}
          {!(data?.top || []).filter((r) => r.hasData).length && !loading && <div className="text-sm text-char-500 col-span-full"><T>No data for this month yet — attendance must be marked for at least 3 days</T></div>}
        </div>
      </Section>
      <DataList loading={loading} rows={rows} rowKey="empCode" onRowClick={(r) => { setSel(r); setRemark(r.remark || ''); }} columns={[
        { key: 'name', label: 'Employee', primary: true, render: (r) => (
          <span>
            {r.name}
            {dupes.includes(r.name) && <span className="ml-1 text-[10px] text-red-500 font-bold">[DUPLICATE]</span>}
            <div className="text-[11px] text-char-500 font-normal">{r.job}</div>
          </span>
        )},
        { key: 'score', label: 'Score', align: 'right', render: (r) => r.hasData ? <Badge tone={tone(r.score)} className="!text-sm">{r.score}</Badge> : <span className="text-xs text-char-400 italic">No data</span> },
        { key: 'presentDays', label: 'Present / absent', render: (r) => `${r.presentDays} / ${r.absent}` },
        { key: 'reports', label: 'Reports on time', render: (r) => `${r.onTime} of ${data?.workingDays}` },
        { key: 'qty', label: 'Output', render: (r) => (r.qty ? `${num(r.qty)} sq ft` : r.tasks ? `${r.tasksDone}/${r.tasks} tasks` : '—') },
        { key: 'breakdowns', label: 'Breakdowns', render: (r) => r.breakdowns || '—' },
        { key: 'remark', label: 'Owner remark', wide: true, render: (r) => r.remark || <span className="text-char-300">—</span> },
      ]} />
      <Pagination page={page} pageSize={size} total={data?.total} shown={rows.length} onPage={setPage} onSize={setSize} />
      <p className="text-[11px] text-char-500 mt-4"><T>Score (0–100) = attendance 35% (late counts ¼ day less) + daily reports on time 25% + work done 30% (sq ft vs best in the same job, or tasks done) + discipline 10% (−30 for each breakdown while operating or complaint linked to the person).</T></p>
      <Sheet open={!!sel} onClose={() => setSel(null)} title={`${sel?.name} – ${fmtMonth(month)}`}
        footer={canRemark ? <><button className="btn-outline flex-1" onClick={() => setSel(null)}><T>Close</T></button><button className="btn-primary flex-[2]" onClick={saveRemark}><T>Save remark</T></button></> : <button className="btn-outline flex-1" onClick={() => setSel(null)}><T>Close</T></button>}>
        {sel && <>
          <div className="text-center mb-3"><div className="text-5xl font-extrabold text-terra">{sel.score}</div><div className="text-xs text-char-500"><T>out of 100</T></div></div>
          <KV label="Attendance score">{sel.attScore}</KV><KV label="Days present / absent / late">{sel.presentDays} / {sel.absent} / {sel.late}</KV>
          <KV label="Daily reports on time"><T vars={{ a: sel.onTime, b: data?.workingDays, c: sel.repScore }}>{'{a} of {b} ({c})'}</T></KV><KV label="Work score">{sel.workScore}</KV>
          <KV label="Output"><T vars={{ n: num(sel.qty) }}>{'{n} sq ft'}</T></KV><KV label="Tasks done">{sel.tasksDone} / {sel.tasks}</KV><KV label="Breakdowns while operating">{sel.breakdowns}</KV><KV label="Complaints linked">{sel.complaints}</KV>
          <Field label="Owner remark" className="mt-4"><textarea className="input" rows={3} value={remark} disabled={!canRemark} onChange={(e) => setRemark(e.target.value)} placeholder={tr('Short remark on this scorecard')} /></Field>
        </>}
      </Sheet>
    </RoleGuard>
  );
}
