'use client';
import ImportData from '@/components/ImportData';
import { AlertTriangle } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Badge } from '@/components/ui';
import { useState } from 'react';
import { useApp, useFetch } from '@/components/Providers';
import DocViewer from '@/components/DocViewer';
import { fileUrl } from '@/lib/client';
import { fmtDate, todayISO, addDays, daysBetween } from '@/lib/format';
import T from '@/components/T';

const CATS = ['Company', 'Licence', 'Machine', 'Vehicle', 'Insurance', 'Agreement', 'Loan', 'Other'];

export default function PapersPage() {
  const { t } = useApp();
  const today = todayISO();
  const [viewer, setViewer] = useState(null);
  const soonQ = useFetch('/api/documents?exp=soon&limit=50&sort=expiryDate&fields=name,expiryDate');
  const expiry = (r) => {
    if (!r.expiryDate) return <span className="text-char-300"><T>No expiry</T></span>;
    const d = daysBetween(today, r.expiryDate);
    if (d < 0) return <Badge tone="red"><T vars={{ n: -d }}>{'Expired {n}d ago'}</T></Badge>;
    if (d <= 7) return <Badge tone="red">{fmtDate(r.expiryDate)} · <T vars={{ n: d }}>{'{n} days left (7-day alert)'}</T></Badge>;
    if (d <= 30) return <Badge tone="amber">{fmtDate(r.expiryDate)} · <T vars={{ n: d }}>{'{n} days left (30-day alert)'}</T></Badge>;
    return <Badge tone="green">{fmtDate(r.expiryDate)}</Badge>;
  };
  return (
    <RoleGuard perm="documents">
      <CrudPage model="documents" headerExtra={<ImportData resource="documents" perm="documents" noun="papers" />} title={t('papers')} subtitle="Licences and certificates in one place — reminder 30 and 7 days before expiry" label="Paper" sort="expiryDate"
        fields={[
          { name: 'name', label: 'Paper name', required: true, wide: true }, { name: 'category', label: 'Category', type: 'select', options: CATS, required: true, default: 'Company' },
          { name: 'expiryDate', label: 'Expiry date (if any)', type: 'date' }, { name: 'file', label: 'Scan / photo / PDF', type: 'doc', resource: 'documents', kind: 'docs', buttonLabel: 'Scan / upload' }, { name: 'note', label: 'Note', type: 'textarea', wide: true },
        ]}
        columns={[{ key: 'name', label: 'Paper', primary: true, render: (r) => <span>{r.name}<div className="text-[11px] text-char-500 font-normal">{r.note}</div></span> }, { key: 'category', label: 'Category' }, { key: 'expiryDate', label: 'Expiry', render: expiry },
          { label: 'File', render: (r) => (r.file ? <a href={fileUrl(r.file)} target="_blank" rel="noreferrer" className="text-terra font-semibold text-sm"><T>View</T></a> : '—') }]}
        filters={[{ key: 'category', label: 'All categories', options: CATS }, { key: 'exp', label: 'Expiry', options: [{ value: 'soon', label: 'Expiring in 30 days' }] }]}
        summary={() => {
          const soon = soonQ.data || []; // picked by the server (named filter on the expiry index)
          return soon.length ? <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2 flex items-center gap-2"><AlertTriangle size={16} /> <T vars={{ n: soon.length >= 50 ? '50+' : soon.length }}>{'{n} paper(s) expiring within 30 days:'}</T> {soon.map((s) => s.name).join(', ')}</div> : null;
        }}
        rowClass={(r) => (r.expiryDate && r.expiryDate <= addDays(today, 7) ? 'bg-red-50/60' : '')}
      />
      <DocViewer src={viewer} title="Paper" onClose={() => setViewer(null)} />
    </RoleGuard>
  );
}
