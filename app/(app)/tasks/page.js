'use client';
import ImportData from '@/components/ImportData';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from '@/lib/toast';
import { CheckCircle2, MessageCircle, AlertTriangle, FolderKanban, Eye } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, Sheet, Field, PhotoInput, Section, SkeletonList } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api, openWA } from '@/lib/client';
import { fmtDate, todayISO, inr, groupBy } from '@/lib/format';
import T from '@/components/T';

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
  const { t, tr, can, session, role } = useApp();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') === 'reminders' ? 'reminders' : 'tasks');
  const [doneRow, setDoneRow] = useState(null);
  const [viewRow, setViewRow] = useState(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');

  const isSupervisor = role === 'supervisor' || session?.role === 'supervisor' || session?.preset === 'supervisor';
  const supervisorEmpCode = session?.empCode;
  const canAssign = can('tasks', 'create');
  const rem = useFetch(tab === 'reminders' ? '/api/reminders' : null);
  const today = todayISO();

  async function markDone(reload) {
    if (!doneRow?._id) return;
    try {
      await api(`/api/tasks/${doneRow._id}`, {
        method: 'PATCH',
        body: { state: 'done', doneNote: note, donePhoto: photo },
      });
      toast.success(isSupervisor ? 'Task submitted ✔' : 'Task done ✔');
      setDoneRow(null);
      setNote('');
      setPhoto('');
      reload?.();
    } catch (e) {
      toast.error(e.message);
    }
  }

  const fields = [
    { name: 'dueDate', label: 'Date', type: 'date', default: () => todayISO(), required: true },
    { name: 'title', label: 'Task', required: true, wide: true, placeholder: 'Write task description…' },
    {
      name: 'assignedCode',
      label: 'Assign to',
      type: 'ref',
      multiple: true,
      required: true,
      placeholder: isSupervisor ? 'Select one or more team members…' : 'Select supervisors or operators…',
      emptyText: isSupervisor ? 'No team members assigned to you' : 'No supervisors or operators found',
      hint: isSupervisor ? 'Select one or more employees working under you' : 'Select one or more supervisors or operators for this task',
      ref: {
        model: 'employees',
        valueKey: 'empCode',
        nameField: 'assignedName',
        label: (e) => `${e.name} (${e.job || 'Staff'})`,
        query: isSupervisor && supervisorEmpCode
          ? { status: 'active', supervisorCode: supervisorEmpCode }
          : { status: 'active', job: 'Supervisor,Worker / operator,Operator,Worker,Helper' },
      },
    },
  ];

  const columns = [
    {
      key: 'title',
      label: 'Task',
      primary: true,
      render: (r) => (
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-char">{r.title}</span>
            {r.priority === 'High' && (
              <Badge tone="red" className="ml-1">
                <T>High</T>
              </Badge>
            )}
          </div>
          {r.details && (
            <div className="text-[11px] text-char-500 font-normal line-clamp-2 mt-0.5 max-w-md">
              {r.details}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'projectName',
      label: 'Project',
      render: (r) => (
        r.projectName ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-terra">
            <FolderKanban size={13} />
            <span>{r.projectName}</span>
          </span>
        ) : <span className="text-char-400 text-xs">—</span>
      ),
    },
    { key: 'assignedName', label: 'Assigned to' },
    {
      key: 'assignedBy',
      label: 'Assigned by',
      render: (r) => <span className="text-xs text-char-600 font-medium">{r.assignedBy || 'Admin'}</span>,
    },
    {
      key: 'dueDate',
      label: 'Date',
      render: (r) => (
        <span className={r.state !== 'done' && r.dueDate < today ? 'text-red-600 font-bold' : ''}>
          {fmtDate(r.dueDate)}
        </span>
      ),
    },
    {
      key: 'state',
      label: 'Status',
      render: (r) => (
        r.state === 'done'
          ? <Badge tone="green"><T>Done</T></Badge>
          : r.dueDate < today
          ? <Badge tone="red"><T>Overdue</T></Badge>
          : <Badge tone="amber"><T>Pending</T></Badge>
      ),
    },
    { key: 'doneNote', label: 'Done note', render: (r) => r.doneNote || '—' },
  ];

  const items = rem.data || [];
  const byType = groupBy(items, 'type');

  return (
    <RoleGuard perm="tasks">
      {can('reminders') && canAssign && <Tabs value={tab} onChange={setTab} tabs={[{ key: 'tasks', label: 'Tasks' }, { key: 'reminders', label: 'Reminder centre' }]} />}
      {tab === 'tasks' && (
        <CrudPage
          model="tasks"
          headerExtra={<ImportData resource="tasks" perm="tasks" noun="tasks" />}
          title={t('tasks')}
          subtitle="Give work to anyone, see what is pending and overdue"
          label="Task"
          addLabel="Assign task"
          fields={fields}
          columns={columns}
          sort="dueDate"
          canAdd={canAssign}
          canEdit={(r) => (!isSupervisor && canAssign && r.state !== 'done')}
          allowVoid={!isSupervisor}
          onRowClick={isSupervisor ? (r) => setViewRow(r) : undefined}
          filters={[{ key: 'state', label: 'All tasks', options: [{ value: 'pending', label: 'Pending' }, { value: 'done', label: 'Done' }, { value: 'overdue', label: 'Overdue' }], toQuery: (v) => (v === 'overdue' ? { overdue: '1' } : { state: v }) }]}
          rowClass={(r) => (r.state !== 'done' && r.dueDate < today ? 'bg-red-50/50' : '')}
          rowActions={(row, { reload }) => {
            if (isSupervisor) {
              const acts = [];
              if (row.state !== 'done') {
                acts.push({
                  label: 'Submit',
                  tone: 'green',
                  icon: <CheckCircle2 size={15} className="text-emerald-600" />,
                  onClick: () => setDoneRow({ ...row, reload }),
                });
              }
              acts.push({
                label: 'View',
                icon: <Eye size={15} className="text-char-600" />,
                onClick: () => setViewRow(row),
              });
              return acts;
            }
            return row.state !== 'done'
              ? [{ label: 'Mark done', tone: 'green', icon: <CheckCircle2 size={14} />, onClick: () => setDoneRow({ ...row, reload }) }]
              : [];
          }}
          onSaved={() => {}}
        />
      )}
      {tab === 'reminders' && (
        <div>
          <p className="text-sm text-char-500 mb-3"><T>The app reminds the right person before anything important is missed. Live counts below.</T></p>
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
                          <button className="btn-green btn-sm shrink-0" onClick={() => openWA(`Dear ${x.customerName}, this is a gentle reminder from Vipul Stone Suppliers: payment of ${inr(x.amount)} is pending against your order. Kindly arrange the payment at the earliest. Thank you.`, x.mobile)}><MessageCircle size={14} /><T> Remind</T></button>
                        )}
                      </div>
                    )) : <div className="text-sm text-char-500"><T>Nothing pending ✔</T></div>}
                  </Section>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── View Task Details Sheet ── */}
      <Sheet
        open={!!viewRow}
        onClose={() => setViewRow(null)}
        title={tr('Task Details')}
        footer={
          <>
            <button className="btn-outline flex-1" onClick={() => setViewRow(null)}>
              <T>Close</T>
            </button>
            {isSupervisor && viewRow?.state !== 'done' && (
              <button
                className="btn-green flex-[2] flex items-center justify-center gap-1.5"
                onClick={() => {
                  const target = viewRow;
                  setViewRow(null);
                  setDoneRow(target);
                }}
              >
                <CheckCircle2 size={16} />
                <T>Submit task</T>
              </button>
            )}
          </>
        }
      >
        {viewRow && (
          <div className="space-y-4">
            <div className="p-3.5 bg-sand-50 border border-sand-200 rounded-sm">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="text-base font-bold text-char">{viewRow.title}</h3>
                <div className="flex items-center gap-1.5 shrink-0">
                  {viewRow.priority === 'High' && <Badge tone="red"><T>High</T></Badge>}
                  {viewRow.state === 'done' ? (
                    <Badge tone="green"><T>Done</T></Badge>
                  ) : viewRow.dueDate < today ? (
                    <Badge tone="red"><T>Overdue</T></Badge>
                  ) : (
                    <Badge tone="amber"><T>Pending</T></Badge>
                  )}
                </div>
              </div>
              {viewRow.details ? (
                <div className="mt-2 text-sm text-char-700 bg-white p-3 border border-sand-200 rounded-sm whitespace-pre-wrap">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-char-400 mb-1">
                    <T>Instructions / Details</T>
                  </div>
                  {viewRow.details}
                </div>
              ) : (
                <div className="text-xs text-char-400 italic"><T>No additional description provided.</T></div>
              )}
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between py-2 border-b border-sand-200">
                <span className="text-char-500"><T>Linked Project</T></span>
                <span className="font-medium text-char">
                  {viewRow.projectName ? (
                    <span className="inline-flex items-center gap-1 text-terra font-semibold">
                      <FolderKanban size={14} />
                      {viewRow.projectName}
                    </span>
                  ) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-sand-200">
                <span className="text-char-500"><T>Assigned to</T></span>
                <span className="font-semibold text-char">{viewRow.assignedName || viewRow.assignedCode || '—'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-sand-200">
                <span className="text-char-500"><T>Assigned by</T></span>
                <span className="font-medium text-char">{viewRow.assignedBy || 'Admin'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-sand-200">
                <span className="text-char-500"><T>Due Date</T></span>
                <span className={viewRow.state !== 'done' && viewRow.dueDate < today ? 'font-bold text-red-600' : 'font-medium text-char'}>
                  {fmtDate(viewRow.dueDate)}
                </span>
              </div>
            </div>

            {viewRow.state === 'done' && (
              <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-sm space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  <T>Submission Details</T>
                </div>
                {viewRow.doneNote && (
                  <div className="text-sm text-char-800">
                    <span className="font-semibold text-char-600"><T>Done note</T>: </span>
                    {viewRow.doneNote}
                  </div>
                )}
                {viewRow.donePhoto && (
                  <div className="mt-2">
                    <div className="text-xs font-semibold text-char-500 mb-1"><T>Attached Photo</T>:</div>
                    <img
                      src={viewRow.donePhoto}
                      alt="Task submission proof"
                      className="max-h-56 rounded border border-emerald-200 object-cover"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Sheet>

      {/* ── Submit / Done Task Modal ── */}
      <Sheet
        open={!!doneRow}
        onClose={() => setDoneRow(null)}
        title={isSupervisor ? tr('Submit Task: {t}', { t: doneRow?.title || '' }) : tr('Done: {t}', { t: doneRow?.title || '' })}
        footer={
          <>
            <button className="btn-outline flex-1" onClick={() => setDoneRow(null)}>
              <T>Cancel</T>
            </button>
            <button className="btn-green flex-[2] flex items-center justify-center gap-1.5" onClick={() => markDone(doneRow.reload)}>
              <CheckCircle2 size={16} />
              <T>{isSupervisor ? 'Submit' : 'Mark done'}</T>
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="text-xs text-char-500">
            {isSupervisor
              ? tr('Enter completion remarks or notes and attach proof photo before submitting.')
              : tr('Record what was done and optionally attach photo proof.')}
          </div>
          <Field label={tr('Note / Remarks')}>
            <textarea
              className="input"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isSupervisor ? tr('Work completion remarks (optional)…') : tr('What was done?')}
            />
          </Field>
          <Field label={tr('Photo Proof')}>
            <PhotoInput value={photo} onChange={setPhoto} />
          </Field>
        </div>
      </Sheet>
    </RoleGuard>
  );
}
