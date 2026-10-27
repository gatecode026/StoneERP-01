'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Building2, BadgeCheck, Cog, Download, FileSignature, FileText, Folder, FolderOpen, Landmark, LayoutGrid, List, Plus, RotateCcw, ShieldCheck, SlidersHorizontal, Trash2, Truck, Pencil, ExternalLink } from 'lucide-react';
import toast from '@/lib/toast';
import { promptDialog } from '@/components/Dialogs';
import ImportData from '@/components/ImportData';
import { Badge, DataList, Pager, Photo, SearchBox, StatCard, Tabs, cx } from '@/components/ui';
import PaperMenu from '@/components/papers/PaperMenu';
import DocViewer from '@/components/DocViewer';
import PaperSheet, { CATEGORIES } from '@/components/papers/PaperSheet';
import { isPdf } from '@/components/papers/DropFile';
import { useApp, useFetch } from '@/components/Providers';
import { useDebounced, useNumberedList } from '@/lib/usePaged';
import { api, fileUrl } from '@/lib/client';
import { daysBetween, fmtDate, todayISO } from '@/lib/format';
import T from '@/components/T';

const FOLDERS = {
  Company: { icon: Building2, hint: 'GST, PAN, bank, registration' },
  Licence: { icon: BadgeCheck, hint: 'Mining lease, pollution, factory' },
  Machine: { icon: Cog, hint: 'Bills, warranty, AMC' },
  Vehicle: { icon: Truck, hint: 'RC, fitness, permit, PUC' },
  Insurance: { icon: ShieldCheck, hint: 'Policies' },
  Agreement: { icon: FileSignature, hint: 'Rent and land agreements' },
  Loan: { icon: Landmark, hint: 'Loan papers' },
  Other: { icon: Folder, hint: '' },
};
const EXPIRY_FILTERS = [{ value: '', label: 'Any expiry' }, { value: 'expired', label: 'Expired' }, { value: 'expiring', label: 'Expiring in 30 days' }, { value: 'noexpiry', label: 'No expiry' }];

/** Expired / expiring / fine, with the days left (reminders go out at 30 and 7 days). */
function ExpiryBadge({ date }) {
  if (!date) return <span className="text-xs text-char-400"><T>No expiry</T></span>;
  const d = daysBetween(todayISO(), date);
  if (d < 0) return <Badge tone="red"><T vars={{ n: -d }}>{'Expired {n}d ago'}</T></Badge>;
  if (d <= 7) return <Badge tone="red">{fmtDate(date)} · <T vars={{ n: d }}>{'{n} days left (7-day alert)'}</T></Badge>;
  if (d <= 30) return <Badge tone="amber">{fmtDate(date)} · <T vars={{ n: d }}>{'{n} days left (30-day alert)'}</T></Badge>;
  return <Badge tone="green">{fmtDate(date)}</Badge>;
}

function FileTile({ paper, size = 'w-11 h-11' }) {
  const Icon = FOLDERS[paper.category]?.icon || FileText;
  return (
    <div className={cx(size, 'rounded-none overflow-hidden bg-terra-50 text-terra grid place-items-center shrink-0 border border-sand-200')}>
      {paper.file && !isPdf(paper.file) ? <Photo src={paper.file} thumb alt="" className={cx(size, 'object-cover')} /> : paper.file ? <FileText size={20} /> : <Icon size={20} />}
    </div>
  );
}

export default function PapersVault() {
  const { tr, can } = useApp();
  const [tab, setTab] = useState('overview'); // overview | folders | bin
  const [folder, setFolder] = useState(null); // null = the folders, 'all' or a category = its papers
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [exp, setExp] = useState('');
  const [cat, setCat] = useState('');
  const [filters, setFilters] = useState(false);
  const [view, setView] = useState('grid');
  const [sheet, setSheet] = useState(null); // { paper } | { category }
  const [viewer, setViewer] = useState(null);
  useEffect(() => { try { setView(localStorage.getItem('vss_papers_view') === 'list' ? 'list' : 'grid'); } catch { /* ignore */ } }, []);
  const pickView = (v) => { setView(v); try { localStorage.setItem('vss_papers_view', v); } catch { /* ignore */ } };

  const inBin = tab === 'trash';
  const stats = useFetch('/api/documents/facets?by=category&named=expired,expiring,noexpiry');
  const soonBy = useFetch(tab === 'folders' ? '/api/documents/facets?by=category&exp=soon' : null);
  const attention = useFetch(tab === 'overview' ? '/api/documents?exp=soon&sort=expiryDate&limit=8' : null);
  const recent = useFetch(tab === 'overview' ? '/api/documents?sort=-createdAt&limit=5' : null);
  const binCount = useFetch('/api/documents/facets?named=bin&includeVoid=1');

  const showList = inBin || (tab === 'folders' && (folder || dq));
  const params = inBin
    ? { includeVoid: 1, bin: 1, sort: '-createdAt', ...(dq ? { q: dq } : {}) }
    : { sort: 'expiryDate', ...(dq ? { q: dq } : {}), ...(folder && folder !== 'all' ? { category: folder } : cat ? { category: cat } : {}), ...(exp ? { [exp]: 1 } : {}) };
  const list = useNumberedList(showList ? '/api/documents' : null, params, { size: 12 });

  const refresh = () => { stats.reload(); soonBy.reload(); attention.reload(); recent.reload(); binCount.reload(); if (showList) list.reload(); };
  const total = stats.data?.total ?? 0;
  const named = stats.data?.named || {};
  const groups = stats.data?.groups || {};
  const soonGroups = soonBy.data?.groups || {};

  function open(p) { if (!p.file) { toast.error('There is no scan attached to this paper'); return; } if (isPdf(p.file)) window.open(fileUrl(p.file), '_blank', 'noopener'); else setViewer(p); }
  async function remove(p) {
    const reason = await promptDialog(tr('Why is “{name}” being deleted?', { name: p.name }), '');
    if (reason === null) return;
    if (!reason.trim()) { toast.error('Write the reason'); return; }
    try { await api(`/api/documents/${p._id}`, { method: 'DELETE', body: { reason: reason.trim() } }); toast.success('Moved to the recycle bin'); refresh(); } catch (e) { toast.error(e.message); }
  }
  async function restore(p) {
    try { await api(`/api/documents/${p._id}/restore`, { method: 'POST', body: {} }); toast.success('Paper restored'); refresh(); } catch (e) { toast.error(e.message); }
  }
  const menu = (p) => (inBin
    ? [can('documents', 'edit') && { key: 'restore', label: 'Restore', icon: <RotateCcw size={15} />, tone: 'primary', onClick: () => restore(p) }]
    : [
      p.file && { key: 'view', label: 'View', icon: <ExternalLink size={15} />, onClick: () => open(p) },
      p.file && { key: 'dl', label: 'Download', icon: <Download size={15} />, onClick: () => window.open(fileUrl(p.file), '_blank', 'noopener') },
      can('documents', 'edit') && { key: 'edit', label: 'Change', icon: <Pencil size={15} />, onClick: () => setSheet({ paper: p }) },
      can('documents', 'void') && { key: 'del', label: 'Delete', icon: <Trash2 size={15} />, danger: true, dividerBefore: true, onClick: () => remove(p) },
    ]).filter(Boolean);

  // ---- one paper, as a card
  const card = (p) => (
    <div key={p._id} className="card p-4 flex flex-col gap-2.5 hover:shadow-md transition cv-auto">
      <div className="flex items-start gap-3">
        <FileTile paper={p} />
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => !inBin && open(p)}>
          <div className="font-bold text-sm truncate" title={p.name}>{p.name}</div>
          <div className="text-[11px] text-char-500 truncate">{p.category}{p.originalAt ? ` · ${p.originalAt}` : ''}</div>
        </div>
        <PaperMenu items={menu(p)} />
      </div>
      {p.note && <p className="text-xs text-char-600 line-clamp-2">{p.note}</p>}
      {(p.tags || []).length > 0 && <div className="flex flex-wrap gap-1">{p.tags.map((t) => <span key={t} className="px-2 py-0.5 rounded-full bg-sand-100 text-[10px] font-semibold text-char-600">#{t}</span>)}</div>}
      <div className="mt-auto pt-1 flex items-center justify-between gap-2">
        {inBin ? <span className="text-[11px] text-char-500 truncate">{p.voidReason}</span> : <ExpiryBadge date={p.expiryDate} />}
        {!inBin && p.file && <button className="text-terra text-xs font-semibold hover:underline shrink-0" onClick={() => open(p)}><T>View</T></button>}
      </div>
    </div>
  );

  const results = () => (
    <>
      {view === 'grid' ? (
        list.loading ? <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-36 skeleton" />)}</div>
          : list.rows.length ? <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{list.rows.map((p) => card(p))}</div>
            : <div className="card p-8 text-center text-char-500 text-sm"><T>{inBin ? 'The recycle bin is empty' : 'No paper found'}</T></div>
      ) : (
        <DataList loading={list.loading} rows={list.rows} empty={inBin ? 'The recycle bin is empty' : 'No paper found'} onRowClick={inBin ? undefined : open}
          columns={[
            { key: 'name', label: 'Paper', primary: true, render: (r) => <span className="flex items-center gap-2.5"><FileTile paper={r} size="w-9 h-9" /><span className="min-w-0"><span className="block font-semibold truncate">{r.name}</span><span className="block text-[11px] text-char-500 font-normal truncate">{r.note}</span></span></span> },
            { key: 'category', label: 'Folder' },
            inBin ? { key: 'voidReason', label: 'Reason', render: (r) => r.voidReason || '—' } : { key: 'expiryDate', label: 'Expiry', render: (r) => <ExpiryBadge date={r.expiryDate} /> },
            { key: 'tags', label: 'Tags', render: (r) => (r.tags || []).map((t) => `#${t}`).join(' ') || '—' },
          ]}
          actions={(r) => <PaperMenu items={menu(r)} />} />
      )}
      <Pager list={list} />
    </>
  );

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="card p-4 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-none bg-terra-50 text-terra grid place-items-center shrink-0"><FolderOpen size={24} /></div>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold leading-tight"><T>Important papers</T></h1>
            <p className="text-xs text-char-500"><T vars={{ n: total }}>{'{n} papers kept. Reminders 30 and 7 days before they expire'}</T></p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('documents', 'create') && <ImportData resource="documents" perm="documents" noun="papers" />}
          {can('documents', 'export') && <button className="btn-outline" onClick={() => window.location.assign('/api/export/documents?format=xlsx&sort=expiryDate')}><Download size={16} /><T> Export list</T></button>}
          {can('documents', 'create') && <button className="btn-primary" onClick={() => setSheet({ category: folder && folder !== 'all' ? folder : undefined })}><Plus size={18} /><T> Add a paper</T></button>}
        </div>
      </div>

      <Tabs value={tab} onChange={(v) => { setTab(v); setFolder(null); setQ(''); }} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'folders', label: 'Folders' }, { key: 'trash', label: 'Recycle bin', count: binCount.data?.named?.bin || undefined }]} />

      {/* the search / filter / view bar (not on the overview) */}
      {tab !== 'overview' && (
        <div className="card p-3 space-y-3">
          <div className="flex items-center gap-2">
            <SearchBox value={q} onChange={setQ} placeholder="Search papers by name, tag or description…" />
            {tab === 'folders' && <button className={cx('btn-outline', filters && '!border-terra')} onClick={() => setFilters(!filters)} aria-expanded={filters}><SlidersHorizontal size={16} /><span className="hidden sm:inline"><T> Filters</T></span></button>}
            <div className="inline-flex rounded-none border border-sand-300 overflow-hidden">
              <button className={cx('p-2.5', view === 'grid' ? 'bg-terra text-white' : 'bg-white text-char-600')} aria-label={tr('Grid view')} aria-pressed={view === 'grid'} onClick={() => pickView('grid')}><LayoutGrid size={16} /></button>
              <button className={cx('p-2.5', view === 'list' ? 'bg-terra text-white' : 'bg-white text-char-600')} aria-label={tr('List view')} aria-pressed={view === 'list'} onClick={() => pickView('list')}><List size={16} /></button>
            </div>
          </div>
          {tab === 'folders' && filters && (
            <div className="flex flex-wrap gap-2">
              <select className="input w-auto" value={exp} onChange={(e) => setExp(e.target.value)} aria-label={tr('Expiry')}>{EXPIRY_FILTERS.map((o) => <option key={o.value} value={o.value}>{tr(o.label)}</option>)}</select>
              {(!folder || folder === 'all') && <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label={tr('Folder')}><option value="">{tr('All folders')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
              {(exp || cat) && <button className="btn-outline btn-sm" onClick={() => { setExp(''); setCat(''); }}><T>Clear filters</T></button>}
            </div>
          )}
        </div>
      )}

      {/* overview */}
      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Papers kept" value={stats.data ? total : '…'} tone="terra" />
            <StatCard label="Expiring in 30 days" value={named.expiring ?? 0} tone={named.expiring ? 'amber' : 'green'} />
            <StatCard label="Expired" value={named.expired ?? 0} tone={named.expired ? 'red' : 'green'} />
            <StatCard label="No expiry date" value={named.noexpiry ?? 0} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <section className="card p-4">
              <h3 className="font-bold text-sm mb-3 flex items-center gap-2"><AlertTriangle size={16} className="text-amber-600" /><T>Needs attention</T></h3>
              {(attention.data || []).length ? (
                <div className="space-y-2">{attention.data.map((p) => (
                  <button key={p._id} className="w-full flex items-center gap-3 text-left rounded-none px-2 py-1.5 hover:bg-sand-50" onClick={() => open(p)}>
                    <FileTile paper={p} size="w-9 h-9" /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold truncate">{p.name}</span><span className="block text-[11px] text-char-500">{p.category}</span></span><ExpiryBadge date={p.expiryDate} />
                  </button>
                ))}</div>
              ) : <p className="text-sm text-emerald-700"><T>Nothing has expired or is about to expire.</T></p>}
            </section>
            <section className="card p-4">
              <h3 className="font-bold text-sm mb-3"><T>By folder</T></h3>
              <div className="space-y-2">
                {CATEGORIES.map((c) => {
                  const n = groups[c]?.n || 0;
                  const Icon = FOLDERS[c].icon;
                  return (
                    <button key={c} className="w-full flex items-center gap-3 text-sm rounded-none px-2 py-1 hover:bg-sand-50" onClick={() => { setTab('folders'); setFolder(c); }}>
                      <Icon size={16} className="text-terra shrink-0" /><span className="w-24 text-left shrink-0">{c}</span>
                      <span className="flex-1 h-2.5 rounded-none bg-sand-100 overflow-hidden"><span className="block h-full bg-terra" style={{ width: `${total ? (n / total) * 100 : 0}%` }} /></span><b className="w-6 text-right">{n}</b>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
          {(recent.data || []).length > 0 && (
            <section className="card p-4">
              <h3 className="font-bold text-sm mb-3"><T>Added recently</T></h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{recent.data.map((p) => (
                <button key={p._id} className="flex items-center gap-3 text-left rounded-none border border-sand-300 px-3 py-2 hover:border-terra" onClick={() => open(p)}>
                  <FileTile paper={p} size="w-9 h-9" /><span className="min-w-0"><span className="block text-sm font-semibold truncate">{p.name}</span><span className="block text-[11px] text-char-500">{p.category} · {fmtDate((p.createdAt || '').slice(0, 10))}</span></span>
                </button>
              ))}</div>
            </section>
          )}
        </>
      )}

      {/* folders */}
      {tab === 'folders' && !showList && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[{ key: 'all', label: 'All papers', icon: FolderOpen, n: total, hint: '' }, ...CATEGORIES.map((c) => ({ key: c, label: c, icon: FOLDERS[c].icon, n: groups[c]?.n || 0, hint: FOLDERS[c].hint, soon: soonGroups[c]?.n || 0 }))].map((f) => {
            const Icon = f.icon;
            return (
              <button key={f.key} className="card p-4 text-center hover:border-terra hover:shadow-md transition flex flex-col items-center gap-1.5" onClick={() => setFolder(f.key)}>
                <span className="w-12 h-12 rounded-none bg-terra-50 text-terra grid place-items-center"><Icon size={22} /></span>
                <span className="font-bold text-sm">{tr(f.label)}</span>
                <span className="text-xs text-char-500"><T vars={{ n: f.n }}>{f.n === 1 ? '1 paper' : '{n} papers'}</T></span>
                {f.hint && <span className="text-[10px] text-char-400 leading-tight"><T>{f.hint}</T></span>}
                {f.soon > 0 && <Badge tone="amber"><T vars={{ n: f.soon }}>{'{n} need attention'}</T></Badge>}
              </button>
            );
          })}
        </div>
      )}
      {tab === 'folders' && showList && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <button className="btn-outline btn-sm" onClick={() => { setFolder(null); setQ(''); }}><ArrowLeft size={14} /><T> Folders</T></button>
            <span className="text-char-500">/</span><b>{dq && !folder ? tr('Search results') : folder === 'all' ? tr('All papers') : folder}</b>
          </div>
          {results()}
        </>
      )}

      {/* recycle bin */}
      {inBin && (<><p className="text-xs text-char-500"><T>A deleted paper stays here with the reason. Nothing is lost: restore it any time.</T></p>{results()}</>)}

      <PaperSheet open={Boolean(sheet)} paper={sheet?.paper} defaultCategory={sheet?.category} onClose={() => setSheet(null)} onSaved={refresh} />
      <DocViewer src={viewer?.file} title={viewer?.name} onClose={() => setViewer(null)} />
    </div>
  );
}
