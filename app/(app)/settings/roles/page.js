'use client';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useEffect, useMemo, useState } from 'react';
import toast from '@/lib/toast';
import { Eye, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, Section, Sheet, Badge, Field, SkeletonList, cx } from '@/components/ui';
import { api } from '@/lib/client';
import { NAV_GROUPS } from '@/lib/nav';
import T from '@/components/T';

// Only the five roles people are given through their Job are shown. The Owner always has every right (fixed, nothing to edit), and the older job presets are no longer assigned.
const EDITABLE_ROLES = ['manager', 'accountant', 'supervisor', 'salesperson', 'worker'];
const SCOPE_LABEL = { '': '—', own: 'Own', team: 'Team', all: 'All' };
const ACT_LABEL = { view: 'See', create: 'Add', edit: 'Edit', void: 'Cancel', approve: 'Approve', export: 'Export' };
const LEVELS = [['none', 'Hidden'], ['masked', 'Masked'], ['read', 'See'], ['write', 'See + change']];
const GROUP_LABEL = { money: 'Money (pay rates, PF/ESI)', cost: 'Cost (purchase rates, block cost, profit)', pii: 'Personal (Aadhaar, PAN, bank, address)' };

function RolesEditor() {
  const { lang, tr } = useApp();
  const { data, loading, error, reload } = useFetch('/api/roles');
  const [sel, setSel] = useState('manager');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  const role = useMemo(() => data?.roles.find((r) => r.key === sel), [data, sel]);
  useEffect(() => { if (role) setDraft({ grants: JSON.parse(JSON.stringify(role.grants)), fields: { ...role.fields }, approvalLimit: role.approvalLimit }); }, [role]);

  const dirty = role && draft && JSON.stringify({ g: role.grants, f: role.fields, a: role.approvalLimit }) !== JSON.stringify({ g: draft.grants, f: draft.fields, a: draft.approvalLimit });
  const groups = useMemo(() => {
    const m = {};
    (data?.catalogue || []).forEach((c) => { (m[c.group] ??= []).push(c); });
    return m;
  }, [data]);

  if (loading || !draft) return error ? <div role="alert" className="card p-4 text-red-600 text-sm">{error.message}</div> : <SkeletonList />;

  const setScope = (res, act, v) => setDraft((d) => {
    const g = { ...d.grants, [res]: { ...(d.grants[res] || {}) } };
    if (v) g[res][act] = v; else delete g[res][act];
    if (!Object.keys(g[res]).length) delete g[res];
    return { ...d, grants: g };
  });

  function broadcastSync() {
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('vss_sync');
        bc.postMessage({ type: 'perm_change' });
        bc.close();
      }
    } catch {}
  }

  async function save() {
    setBusy(true);
    try {
      await api(`/api/roles/${sel}`, { method: 'PUT', body: draft });
      toast.success('Saved. The change applies to this role immediately.');
      broadcastSync();
      reload();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }
  async function reset() {
    if (!await confirmDialog('Reset this role to the standard permissions from the requirements document?')) return;
    setBusy(true);
    try {
      await api(`/api/roles/${sel}/reset`, { method: 'POST', body: {} });
      toast.success('Reset to defaults');
      broadcastSync();
      reload();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }

  const canSee = (res) => Boolean(draft.grants[res]?.view);
  const nav = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => (it.res || []).some(canSee)) })).filter((g) => g.items.length);

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4 md:mx-0 md:px-0" style={{ scrollbarWidth: 'none' }} role="tablist" aria-label={tr('Roles')}>
        {data.roles.filter((r) => EDITABLE_ROLES.includes(r.key)).map((r) => (
          <button key={r.key} role="tab" aria-selected={sel === r.key} onClick={() => setSel(r.key)}
            className={cx('shrink-0 min-h-[44px] px-4 rounded-full text-sm font-semibold border transition', sel === r.key ? 'bg-terra text-white border-terra' : 'bg-white text-char-700 border-sand-300')}>
            {r.label[lang] || r.label.en}{r.custom && <span className="ml-1.5 text-[10px] opacity-80"><T>edited</T></span>}
          </button>
        ))}
      </div>

      <div className="card p-3 mb-3 grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-2 sticky top-[56px] z-30">
        <div className="col-span-3 flex items-center gap-2 sm:contents"><ShieldCheck size={18} className="text-terra shrink-0" />
        <div className="text-sm flex-1 min-w-[160px]"><b>{role.label.en}</b> {role.base ? <Badge tone="gray"><T>base role</T></Badge> : <Badge tone="blue"><T>job preset</T></Badge>}{dirty && <Badge tone="amber" className="ml-1.5"><T>unsaved</T></Badge>}</div>
        </div>
        <button className="btn-outline btn-sm w-full sm:w-auto" onClick={() => setPreview(true)}><Eye size={14} /> <span><T>View as</T></span></button>
        <button className="btn-outline btn-sm w-full sm:w-auto" onClick={reset} disabled={busy || !role.custom}><RotateCcw size={14} /><T> Reset</T></button>
        <button className="btn-primary btn-sm w-full sm:w-auto" onClick={save} disabled={busy || !dirty}><Save size={14} /><T> Save</T></button>
      </div>

      <Section title="Hidden information (applies to every screen)" className="mb-3">
        <div className="grid sm:grid-cols-3 gap-3">
          {Object.keys(GROUP_LABEL).map((g) => (
            <Field key={g} label={GROUP_LABEL[g]} htmlFor={`fg_${g}`}>
              <select id={`fg_${g}`} className="input" value={draft.fields[g]} onChange={(e) => setDraft({ ...draft, fields: { ...draft.fields, [g]: e.target.value } })}>
                {LEVELS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
              </select>
            </Field>
          ))}
        </div>
        <Field label="Approval limit (₹) — above this the item shows “needs Owner”" htmlFor="alimit" className="mt-3 max-w-xs">
          <input id="alimit" className="input" type="number" inputMode="numeric" min="0" placeholder={tr('No limit')} value={draft.approvalLimit ?? ''}
            onChange={(e) => setDraft({ ...draft, approvalLimit: e.target.value === '' ? null : Number(e.target.value) })} />
        </Field>
      </Section>

      {Object.entries(groups).map(([g, items]) => (
        <Section key={g} title={tr(g[0].toUpperCase() + g.slice(1))} className="mb-3">
          <div className="space-y-3">
            {items.map((c) => (
              <div key={c.key} className="rounded-none border border-sand-200 p-3">
                <div className="font-semibold text-sm mb-2">{c.label[lang] || c.label.en}{c.part ? <span className="text-char-500 font-normal text-xs"> · <T vars={{ n: c.part }}>{'Part {n}'}</T></span> : null}</div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {c.actions.map((a) => {
                    const opts = [''].concat(c.hasOwn ? ['own'] : [], c.hasTeam ? ['team'] : [], ['all']);
                    return (
                      <label key={a} className="block">
                        <span className="block text-[11px] font-semibold text-char-500 mb-0.5">{c.actionLabels?.[a]?.[lang] || c.actionLabels?.[a]?.en || tr(ACT_LABEL[a])}</span>
                        <select className="input !min-h-[40px] !px-2 text-sm" aria-label={`${c.label[lang] || c.label.en} – ${c.actionLabels?.[a]?.en || tr(ACT_LABEL[a])}`}
                          value={draft.grants[c.key]?.[a] || ''} onChange={(e) => setScope(c.key, a, e.target.value)}>
                          {opts.map((o) => <option key={o} value={o}>{tr(SCOPE_LABEL[o])}</option>)}
                        </select>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ))}
      <p className="text-[11px] text-char-500 mb-24"><T>Own = only records about the person · Team = the people they supervise · All = everyone. The Owner role is fixed and always has full access, so the Owner can never be locked out. Every change is written to the audit trail with before and after.</T></p>

      <Sheet open={preview} onClose={() => setPreview(false)} title={tr('What “{r}” sees', { r: role.label[lang] || role.label.en })}>
        {nav.length ? nav.map((g) => (
          <div key={g.key} className="mb-3"><div className="text-[11px] font-bold uppercase text-char-500 mb-1">{g.key.replace('g_', '')}</div>
            <div className="flex flex-wrap gap-1.5">{g.items.map((it) => <span key={it.key} className="badge-gray">{it.key}</span>)}</div></div>
        )) : <div className="text-sm text-char-500"><T>This role can open nothing.</T></div>}
        <p className="text-xs text-char-500 mt-3"><T>Based on the unsaved settings on this screen. The real screens also hide any button the person may not use.</T></p>
      </Sheet>
    </div>
  );
}

export default function RolesPage() {
  return (
    <RoleGuard perm="roles">
      <PageHeader title="Roles and permissions" subtitle="Decide what each role can see and do — changes apply immediately" />
      <RolesEditor />
    </RoleGuard>
  );
}
