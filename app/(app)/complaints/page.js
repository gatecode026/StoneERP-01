'use client';
import toast from 'react-hot-toast';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Badge, Section } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { api } from '@/lib/client';
import { fmtDate, todayISO, daysBetween, groupBy } from '@/lib/format';

const STATES = [{ value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'closed', label: 'Closed' }];
const PROBLEMS = ['Broken pieces', 'Wrong size', 'Colour difference', 'Short quantity', 'Other'];
const ACTIONS = [{ value: 'replace', label: 'Replace' }, { value: 'discount', label: 'Discount' }, { value: 'credit_note', label: 'Credit note' }, { value: 'reject', label: 'Reject (give reason)' }];

export default function ComplaintsPage() {
  const { t } = useApp();
  const fields = [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'customerId', label: 'Customer', type: 'ref', required: true, ref: { model: 'customers', nameField: 'customerName' } },
    { name: 'invoiceNo', label: 'Bill number' },
    { name: 'problem', label: 'Problem', type: 'select', options: PROBLEMS, required: true },
    { name: 'details', label: 'Details', type: 'textarea', wide: true },
    { name: 'photo', label: 'Photos', type: 'photo' },
    { name: 'action', label: 'Action decided', type: 'select', options: ACTIONS },
    { name: 'actionNote', label: 'Reason / remark', wide: true },
    { name: 'state', label: 'Status', type: 'select', options: STATES, default: 'open' },
  ];
  const columns = [
    { key: 'complaintNo', label: 'No.', primary: true, render: (r) => <span>{r.complaintNo}<div className="text-[11px] text-char-500 font-normal">{r.customerName}</div></span> },
    { key: 'problem', label: 'Problem' },
    { key: 'invoiceNo', label: 'Bill', render: (r) => r.invoiceNo || '—' },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'action', label: 'Action', render: (r) => ACTIONS.find((a) => a.value === r.action)?.label || '—' },
    { key: 'days', label: 'Days', render: (r) => (r.state === 'closed' ? `${r.daysTaken ?? 0} taken` : `${daysBetween(r.date, todayISO())} open`) },
    { key: 'state', label: 'Status', render: (r) => <Badge tone={r.state === 'closed' ? 'green' : r.state === 'open' ? 'red' : 'amber'}>{STATES.find((s) => s.value === r.state)?.label}</Badge> },
  ];
  return (
    <RoleGuard perm="complaints">
      <CrudPage model="complaints" title={t('complaints')} subtitle="Followed until closed" label="Complaint" fields={fields} columns={columns} sort="-date,-createdAt"
        searchKeys={['complaintNo', 'customerName', 'problem', 'invoiceNo']} exportName="complaints"
        filters={[{ key: 'state', label: 'All status', options: STATES }, { key: 'problem', label: 'All problems', options: PROBLEMS }]}
        summary={(rows, all) => {
          const g = Object.entries(groupBy(all, 'problem')).sort((a, b) => b[1].length - a[1].length);
          return (
            <Section title="By problem type (all complaints)">
              <div className="flex flex-wrap gap-2">{g.map(([k, v]) => <Badge key={k} tone="gray">{k}: {v.length}</Badge>)}</div>
            </Section>
          );
        }}
        rowClass={(r) => (r.state === 'open' ? 'bg-red-50/50' : '')}
        rowActions={(row, { reload }) => (row.state !== 'closed' ? [
          row.state === 'open' && { label: 'Start', onClick: async () => { try { await api(`/api/complaints/${row._id}`, { method: 'PATCH', body: { state: 'in_progress' } }); reload(); } catch (e) { toast.error(e.message); } } },
          { label: 'Close', tone: 'green', onClick: async () => { try { await api(`/api/complaints/${row._id}`, { method: 'PATCH', body: { state: 'closed' } }); toast.success('Complaint closed'); reload(); } catch (e) { toast.error(e.message); } } },
        ].filter(Boolean) : [])}
      />
    </RoleGuard>
  );
}
