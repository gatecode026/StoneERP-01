'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { CheckCircle2, MessageCircle, AlertTriangle } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, Sheet, Field, PhotoInput, Section, SkeletonList } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api, openWA } from '@/lib/client';
import { fmtDate, todayISO, inr, groupBy } from '@/lib/format';

const REMINDER_TABLE = [
  ['customer_payment', 'Customer payment overdue', 'Salesperson, accountant, customer'],
  ['supplier_payment', 'Supplier payment due', 'Accountant'],
  ['stock_low', 'Stock below minimum', 'Store keeper, owner'],
  ['service_due', 'Machine service due', 'Mechanic, supervisor'],
  ['report_missing', 'Daily work report not filled', 'Employee, supervisor'],
  ['salary_date', 'Salary date', 'Accountant, owner'],
  ['paper_expiry', 'Licence, insurance, vehicle papers or lease expiring', 'Owner'],
  ['request', 'Employee leave or advance request', 'Owner / manager to approve'],
  ['task_overdue', 'Overdue tasks', 'Assignee, owner'],
];

export default function TasksPage() {
  const { t, can } = useApp();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') === 'reminders' ? 'reminders' : 'tasks');
  const [doneRow, setDoneRow] = useState(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');
  const canAssign = can('tasks', 'create');
  const rem = useFetch(tab === 'reminders' ? '/api/reminders' : null);
  const today = todayISO();

  async function markDone(reload) {
    try { await api(`/api/tasks/${doneRow._id}`, { method: 'PATCH', body: { state: 'done', doneNote: note, donePhoto: photo } }); toast.success('Task done ✔'); setDoneRow(null); setNote(''); setPhoto(''); reload(); } catch (e) { toast.error(e.message); }
  }

  const fields = [
    { name: 'title', label: 'Task', required: true, wide: true },
    { name: 'details', label: 'Details', type: 'textarea', wide: true },
    { name: 'assignedCode', label: 'Assign to', type: 'ref', required: true, ref: { model: 'employees', valueKey: 'empCode', nameField: 'assignedName', label: (e) => `${e.name} (${e.job})`, query: { status: 'active' } } },
    { name: 'dueDate', label: 'Due date', type: 'date', required: true },
    { name: 'priority', label: 'Priority', type: 'select', options: ['Normal', 'High'], default: 'Normal' },
  ];
  const columns = [
    { key: 'title', label: 'Task', primary: true, render: (r) => <span>{r.title}{r.priority === 'High' && <Badge tone="red" className="ml-1.5">High</Badge>}<div className="text-[11px] text-char-500 font-normal">{r.details}</div></span> },
    { key: 'assignedName', label: 'Assigned to' },
    { key: 'dueDate', label: 'Due', render: (r) => <span className={r.state !== 'done' && r.dueDate < today ? 'text-red-600 font-bold' : ''}>{fmtDate(r.dueDate)}</span> },
    { key: 'state', label: 'Status', render: (r) => (r.state === 'done' ? <Badge tone="green">Done</Badge> : r.dueDate < today ? <Badge tone="red">Overdue</Badge> : <Badge tone="amber">Pending</Badge>) },
    { key: 'doneNote', label: 'Done note', render: (r) => r.doneNote || '—' },
  ];

  const items = rem.data || [];
  const byType = groupBy(items, 'type');

  return (
    <RoleGuard perm="tasks">
      {can('reminders') && canAssign && <Tabs value={tab} onChange={setTab} tabs={[{ key: 'tasks', label: 'Tasks' }, { key: 'reminders', label: 'Reminder centre' }]} />}
      {tab === 'tasks' && (
        <CrudPage model="tasks" title={t('tasks')} subtitle="Give work to anyone, see what is pending and overdue" label="Task" addLabel="Assign task" fields={fields} columns={columns}
          sort="dueDate" searchKeys={['title', 'assignedName']} canAdd={canAssign} canEdit={(r) => canAssign && r.state !== 'done'}
          filters={[{ key: 'state', label: 'All tasks', options: [{ value: 'pending', label: 'Pending' }, { value: 'done', label: 'Done' }, { value: 'overdue', label: 'Overdue' }], test: (r, v) => (v === 'overdue' ? r.state !== 'done' && r.dueDate < today : r.state === v) }]}
          rowClass={(r) => (r.state !== 'done' && r.dueDate < today ? 'bg-red-50/50' : '')}
          rowActions={(row, { reload }) => (row.state !== 'done' ? [{ label: 'Mark done', tone: 'green', icon: <CheckCircle2 size={14} />, onClick: () => { setDoneRow({ ...row, reload }); } }] : [])}
          onSaved={() => {}} />
      )}
      {tab === 'reminders' && (
        <div>
          <p className="text-sm text-char-500 mb-3">The app reminds the right person before anything important is missed. Live counts below.</p>
          {rem.loading ? <SkeletonList /> : (
            <div className="space-y-3">
              {REMINDER_TABLE.map(([type, label, to]) => {
                const list = byType[type] || [];
                return (
                  <Section key={type} title={<span className="flex items-center gap-2">{label} <Badge tone={list.length ? 'red' : 'green'}>{list.length}</Badge></span>} right={<span className="text-[11px] text-char-500">→ {to}</span>}>
                    {list.length ? list.map((x, i) => (
                      <div key={i} className="flex items-start justify-between gap-2 py-2 border-b border-sand-100 last:border-0 text-sm">
                        <Link href={x.link || '/'} className="flex-1"><AlertTriangle size={13} className={`inline mr-1 -mt-0.5 ${x.severity === 'high' ? 'text-red-500' : 'text-amber-500'}`} />{x.title}{x.detail && <div className="text-xs text-char-500">{x.detail}</div>}</Link>
                        {x.type === 'customer_payment' && (
                          <button className="btn-green btn-sm shrink-0" onClick={() => openWA(`Dear ${x.customerName}, this is a gentle reminder from Vipul Stone Suppliers: payment of ${inr(x.amount)} is pending against your order. Kindly arrange the payment at the earliest. Thank you.`, x.mobile)}><MessageCircle size={14} /> Remind</button>
                        )}
                      </div>
                    )) : <div className="text-sm text-char-500">Nothing pending ✔</div>}
                  </Section>
                );
              })}
            </div>
          )}
        </div>
      )}
      <Sheet open={!!doneRow} onClose={() => setDoneRow(null)} title={`Done: ${doneRow?.title || ''}`}
        footer={<><button className="btn-outline flex-1" onClick={() => setDoneRow(null)}>Cancel</button><button className="btn-green flex-[2]" onClick={() => markDone(doneRow.reload)}>Mark done</button></>}>
        <div className="space-y-3">
          <Field label="Note"><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done?" /></Field>
          <Field label="Photo"><PhotoInput value={photo} onChange={setPhoto} /></Field>
        </div>
      </Sheet>
    </RoleGuard>
  );
}
