'use client';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import LookupSelect from '@/components/LookupSelect';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound, Plus, UserCog } from 'lucide-react';
import { useApp, useFetch } from '@/components/Providers';
import { RoleGuard, PageHeader, DataList, Sheet, Field, Badge, SearchBox } from '@/components/ui';
import { api } from '@/lib/client';
import { fmtDateTime } from '@/lib/format';

const ROLES = ['owner', 'manager', 'accountant', 'supervisor', 'salesperson', 'worker'];
const PRESETS = [['', 'None'], ['store_keeper', 'Store keeper'], ['yard_incharge', 'Yard / gate in-charge'], ['guard', 'Guard'], ['mechanic', 'Mechanic'], ['cashier', 'Cashier'], ['driver', 'Driver']];
const EXTRA = [['documents', 'Important papers'], ['purchases', 'Purchases'], ['salarysheets', 'Salary sheet'], ['cashentries', 'Cash book'], ['auditlogs', 'Audit trail']];

export default function UsersPage() {
  const { can } = useApp();
  const [q, setQ] = useState('');
  const { data, loading, reload } = useFetch(`/api/users?q=${encodeURIComponent(q)}`, [q]);
  const [edit, setEdit] = useState(null); // user | {} for new
  const [f, setF] = useState({});
  const [secret, setSecret] = useState(null);
  const [busy, setBusy] = useState(false);

  function open(u) {
    setEdit(u || {});
    setF(u ? { name: u.name, role: u.role, preset: u.preset || '', empCode: u.empCode || '', extra: Object.fromEntries((u.extraAccess || []).map((x) => [x.resource, true])) } : { name: '', username: '', role: 'worker', preset: '', empCode: '', extra: {} });
  }
  const extraAccess = () => Object.entries(f.extra || {}).filter(([, v]) => v).map(([resource]) => ({ resource, actions: ['view'], scope: 'all' }));

  async function save() {
    setBusy(true);
    try {
      if (edit._id || edit.id) {
        await api(`/api/users/${edit.id}`, { method: 'PATCH', body: { name: f.name, role: f.role, preset: f.preset || null, extraAccess: extraAccess() } });
        toast.success('Saved. The person must sign in again to get the new access.');
      } else {
        const r = await api('/api/users', { method: 'POST', body: { username: f.username, name: f.name, role: f.role, preset: f.preset || null, empCode: f.empCode || undefined, extraAccess: extraAccess() } });
        setSecret({ name: f.name, username: f.username, password: r.temporaryPassword });
      }
      setEdit(null); reload();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }
  async function reset(u) {
    if (!await confirmDialog(`Give ${u.name} a new temporary password? They will be signed out everywhere.`)) return;
    try { const r = await api(`/api/users/${u.id}/reset-password`, { method: 'POST', body: {} }); setSecret({ name: u.name, username: u.username, password: r.temporaryPassword }); } catch (e) { toast.error(e.message); }
  }
  async function toggle(u) {
    try { await api(`/api/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); toast.success(u.active ? 'Deactivated' : 'Activated'); reload(); } catch (e) { toast.error(e.message); }
  }

  return (
    <RoleGuard perm="users">
      <PageHeader title="Users" subtitle="Everyone gets their own login (mobile number + password)"
        actions={can('users', 'create') && <button className="btn-primary" onClick={() => open(null)}><Plus size={18} /> New user</button>} />
      <div className="mb-3"><SearchBox value={q} onChange={setQ} /></div>
      <DataList loading={loading} rows={data || []} rowKey="id" columns={[
        { key: 'name', label: 'Name', primary: true, render: (r) => <span>{r.name}<div className="text-[11px] text-char-500 font-normal">{r.username}{r.empCode ? ` · ${r.empCode}` : ''}</div></span> },
        { key: 'role', label: 'Role', render: (r) => <span className="capitalize">{r.preset ? r.preset.replace('_', ' ') : r.role}</span> },
        { key: 'extraAccess', label: 'Extra access', render: (r) => (r.extraAccess?.length ? r.extraAccess.map((x) => x.resource).join(', ') : '—') },
        { key: 'lastLoginAt', label: 'Last sign-in', render: (r) => (r.lastLoginAt ? fmtDateTime(r.lastLoginAt) : 'never') },
        { key: 'active', label: 'Status', render: (r) => (r.active ? (r.mustChangePassword ? <Badge tone="amber">first sign-in pending</Badge> : <Badge tone="green">active</Badge>) : <Badge tone="red">deactivated</Badge>) },
      ]} actions={(r) => (
        <div className="flex items-center gap-1.5 justify-end flex-nowrap whitespace-nowrap">
          {can('users', 'edit') && <button className="icon-btn" aria-label="Edit user" title="Edit" onClick={() => open(r)}><UserCog size={16} /></button>}
          {can('users', 'edit') && <button className="icon-btn" aria-label="Reset password" title="Reset password" onClick={() => reset(r)}><KeyRound size={16} /></button>}
          {can('users', 'edit') && <button className="btn-outline btn-sm" onClick={() => toggle(r)}>{r.active ? 'Deactivate' : 'Activate'}</button>}
        </div>
      )} />

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit user' : 'New user'}
        footer={<><button className="btn-outline flex-1" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary flex-[2]" disabled={busy} onClick={save}>Save</button></>}>
        <div className="space-y-3">
          <Field label="Name" htmlFor="u_name" required><input id="u_name" className="input" value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          {!edit?.id && <Field label="Mobile number (this is the login)" htmlFor="u_mob" required><input id="u_mob" className="input" inputMode="numeric" maxLength={10} value={f.username || ''} onChange={(e) => setF({ ...f, username: e.target.value.replace(/\D/g, '') })} /></Field>}
          <Field label="Role" htmlFor="u_role"><select id="u_role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
          <Field label="Job preset (optional)" htmlFor="u_preset" hint="A restricted variant: guard, store keeper, mechanic, cashier, driver…"><select id="u_preset" className="input" value={f.preset} onChange={(e) => setF({ ...f, preset: e.target.value })}>{PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          {!edit?.id && (
            <Field label="Linked employee" htmlFor="u_emp" hint="Needed so “own” records (report, attendance, slip) can be found">
              <LookupSelect id="u_emp" kind="employees" by="empCode" value={f.empCode} onChange={(it) => setF({ ...f, empCode: it ? it.id : '' })} placeholder="Not an employee — search to link one" />
            </Field>
          )}
          <div>
            <div className="label">Extra access for this person only (view)</div>
            <div className="grid grid-cols-2 gap-1">
              {EXTRA.map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 min-h-[44px] text-sm"><input type="checkbox" className="w-5 h-5 accent-[#B5651D]" checked={!!f.extra?.[k]} onChange={(e) => setF({ ...f, extra: { ...f.extra, [k]: e.target.checked } })} />{l}</label>
              ))}
            </div>
          </div>
        </div>
      </Sheet>

      <Sheet open={!!secret} onClose={() => setSecret(null)} title="Temporary password"
        footer={<button className="btn-primary w-full" onClick={() => setSecret(null)}>Done</button>}>
        <p className="text-sm mb-3">Give this to <b>{secret?.name}</b> now. It is shown only once; they must choose their own password at first sign-in.</p>
        <div className="rounded-xl bg-sand-100 p-4 text-center"><div className="text-xs text-char-500">Mobile</div><div className="font-bold text-lg">{secret?.username}</div><div className="text-xs text-char-500 mt-2">Password</div><div className="font-mono text-2xl font-extrabold tracking-wider select-all">{secret?.password}</div></div>
      </Sheet>
    </RoleGuard>
  );
}
