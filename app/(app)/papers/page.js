'use client';
import { AlertTriangle } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Badge } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { fmtDate, todayISO, addDays, daysBetween } from '@/lib/format';

const CATS = ['Company', 'Licence', 'Machine', 'Vehicle', 'Insurance', 'Agreement', 'Loan', 'Other'];

export default function PapersPage() {
  const { t } = useApp();
  const today = todayISO();
  const expiry = (r) => {
    if (!r.expiryDate) return <span className="text-char-300">No expiry</span>;
    const d = daysBetween(today, r.expiryDate);
    if (d < 0) return <Badge tone="red">Expired {-d}d ago</Badge>;
    if (d <= 7) return <Badge tone="red">{fmtDate(r.expiryDate)} · {d} days left (7-day alert)</Badge>;
    if (d <= 30) return <Badge tone="amber">{fmtDate(r.expiryDate)} · {d} days left (30-day alert)</Badge>;
    return <Badge tone="green">{fmtDate(r.expiryDate)}</Badge>;
  };
  return (
    <RoleGuard perm="papers">
      <CrudPage model="documents" title={t('papers')} subtitle="Licences and certificates in one place — reminder 30 and 7 days before expiry" label="Paper" sort="expiryDate" searchKeys={['name', 'category', 'note']}
        fields={[
          { name: 'name', label: 'Paper name', required: true, wide: true }, { name: 'category', label: 'Category', type: 'select', options: CATS, required: true, default: 'Company' },
          { name: 'expiryDate', label: 'Expiry date (if any)', type: 'date' }, { name: 'file', label: 'Scan / photo', type: 'photo', buttonLabel: 'Scan / upload' }, { name: 'note', label: 'Note', type: 'textarea', wide: true },
        ]}
        columns={[{ key: 'name', label: 'Paper', primary: true, render: (r) => <span>{r.name}<div className="text-[11px] text-char-500 font-normal">{r.note}</div></span> }, { key: 'category', label: 'Category' }, { key: 'expiryDate', label: 'Expiry', render: expiry },
          { label: 'File', render: (r) => (r.file ? <a href={r.file} target="_blank" rel="noreferrer" className="text-terra font-semibold text-sm" onClick={(e) => { e.preventDefault(); const w = window.open(); w.document.write(`<img src="${r.file}" style="max-width:100%">`); }}>View</a> : '—') }]}
        filters={[{ key: 'category', label: 'All categories', options: CATS }, { key: 'exp', label: 'Expiry', options: [{ value: 'soon', label: 'Expiring in 30 days' }], test: (r) => r.expiryDate && r.expiryDate <= addDays(today, 30) }]}
        summary={(rows, all) => {
          const soon = all.filter((r) => r.expiryDate && r.expiryDate <= addDays(today, 30));
          return soon.length ? <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2 flex items-center gap-2"><AlertTriangle size={16} /> {soon.length} paper(s) expiring within 30 days: {soon.map((s) => s.name).join(', ')}</div> : null;
        }}
        rowClass={(r) => (r.expiryDate && r.expiryDate <= addDays(today, 7) ? 'bg-red-50/60' : '')}
      />
    </RoleGuard>
  );
}
