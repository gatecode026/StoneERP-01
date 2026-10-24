'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from '@/lib/toast';
import { CheckCircle2, Clock, FolderOpen, FolderCheck, Users, AlertTriangle, Plus, ClipboardList } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, PageHeader, StatCard, Section, Sheet, Field, SkeletonList } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api } from '@/lib/client';
import { fmtDate, todayISO, groupBy } from '@/lib/format';
import T from '@/components/T';

// ─── Supervisor Dashboard ────────────────────────────────────────────────────
// Shows:
//  1. Today's work assignments for this supervisor's team
//  2. Ongoing Projects (tasks with project tag, state=pending)
//  3. Completed Projects
//  4. Admin/Manager can assign work from here
// ─────────────────────────────────────────────────────────────────────────────

export default function SupervisorPage() {
  const { t, tr, can, session } = useApp();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'today');
  const [doneRow, setDoneRow] = useState(null);
  const [note, setNote] = useState('');
  const today = todayISO();
  const isSupervisor = session?.role === 'supervisor' || can('tasks', 'view');
  const canAssign = can('tasks', 'create');
  const mySupervisorCode = session?.empCode;

  // Today's tasks for this supervisor's team
  const todayTasks = useFetch(tab === 'today' ? `/api/tasks?dueDate=${today}&limit=200&count=1` : null, [today, tab]);
  // Ongoing projects (tasks with priority=High or tagged as project, pending)
  const ongoingTasks = useFetch(tab === 'ongoing' ? `/api/tasks?state=pending&limit=200&count=1` : null, [tab]);
  // Completed tasks
  const doneTasks = useFetch(tab === 'completed' ? `/api/tasks?state=done&limit=200&count=1` : null, [tab]);

  // Summary counts for stat cards (always fetch)
  const summary = useFetch('/api/tasks?count=1&limit=1', [today]);
  const pendingCount = summary.data?.total ?? 0;
  const overdueTasks = useFetch('/api/tasks?overdue=1&count=1&limit=1', [today]);
  const overdueCount = overdueTasks.data?.total ?? 0;

  async function markDone(row, reload) {
    try {
      await api(`/api/tasks/${row._id}`, { method: 'PATCH', body: { state: 'done', doneNote: note } });
      toast.success('Marked done ✔');
      setDoneRow(null); setNote(''); reload?.();
    } catch (e) { toast.error(e.message); }
  }

  const taskFields = [
    { name: 'title', label: 'Work / Task', required: true, wide: true, placeholder: 'e.g. Cut 200 sq ft Kotah Blue' },
    { name: 'details', label: 'Details / Instructions', type: 'textarea', wide: true },
    { name: 'assignedCode', label: 'Assign to (Worker / Supervisor)', type: 'ref', required: true,
      ref: { model: 'employees', valueKey: 'empCode', nameField: 'assignedName', label: (e) => `${e.name} (${e.job})`, query: { status: 'active' } } },
    { name: 'dueDate', label: 'Due date', type: 'date', required: true },
    { name: 'priority', label: 'Priority', type: 'select', options: ['Normal', 'High', 'Project'], default: 'Normal' },
  ];

  // Shared task columns
  const taskCols = (showDone) => [
    { key: 'title', label: 'Work', primary: true, render: (r) => (
      <span>
        {r.title}
        {r.priority === 'High' && <Badge tone="red" className="ml-1.5 !text-[10px]">High</Badge>}
        {r.priority === 'Project' && <Badge tone="blue" className="ml-1.5 !text-[10px]">Project</Badge>}
        <div className="text-[11px] text-char-500 font-normal">{r.details}</div>
      </span>
    )},
    { key: 'assignedName', label: 'Worker / Team' },
    { key: 'dueDate', label: 'Due', render: (r) => (
      <span className={r.state !== 'done' && r.dueDate < today ? 'text-red-600 font-bold' : ''}>
        {fmtDate(r.dueDate)}
      </span>
    )},
    { key: 'state', label: 'Status', render: (r) => (
      r.state === 'done'
        ? <Badge tone="green">Done ✔</Badge>
        : r.dueDate < today
          ? <Badge tone="red">Overdue</Badge>
          : <Badge tone="amber">Pending</Badge>
    )},
    ...(showDone ? [{ key: 'doneNote', label: 'Done note', render: (r) => r.doneNote || '—' }] : []),
  ];

  const rowActionsForTask = (row, { reload }) => {
    const actions = [];
    if (row.state !== 'done') {
      actions.push({ label: 'Mark done', tone: 'green', icon: <CheckCircle2 size={14} />, onClick: () => setDoneRow({ ...row, reload }) });
    }
    return actions;
  };

  return (
    <RoleGuard perm="tasks">
      <PageHeader
        title="Supervisor Dashboard"
        subtitle="Daily work assignments · Ongoing & Completed projects"
      />

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Pending tasks" value={pendingCount} tone={pendingCount > 0 ? 'amber' : 'green'} />
        <StatCard label="Overdue" value={overdueCount} tone={overdueCount > 0 ? 'red' : 'green'} />
        <StatCard label="Today" value={todayTasks.data?.total ?? '…'} />
        <StatCard label="Done" value={doneTasks.data?.total ?? '…'} tone="green" />
      </div>

      {overdueCount > 0 && (
        <div className="mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 flex items-center gap-2">
          <AlertTriangle size={15} />
          <span><b>{overdueCount} overdue tasks.</b> Switch to "Ongoing" tab to see and action them.</span>
        </div>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'today', label: "Today's Work" },
        { key: 'assign', label: canAssign ? 'Assign Work' : null },
        { key: 'ongoing', label: 'Ongoing Projects' },
        { key: 'completed', label: 'Completed' },
      ].filter((t) => t.label)} />

      {/* ── TODAY'S WORK ── */}
      {tab === 'today' && (
        <CrudPage
          model="tasks"
          title="Today's Work Assignments"
          subtitle={`Tasks due on ${fmtDate(today)}`}
          label="Task"
          addLabel="Assign today's work"
          baseQuery={{ dueDate: today }}
          sort="dueDate"
          fields={taskFields}
          columns={taskCols(false)}
          canAdd={canAssign}
          canEdit={(r) => canAssign && r.state !== 'done'}
          rowClass={(r) => (r.state === 'done' ? 'opacity-60' : r.dueDate < today ? 'bg-red-50/50' : '')}
          rowActions={rowActionsForTask}
          emptyText="No work assigned for today — use 'Assign Work' tab to add tasks"
          onSaved={() => {}}
        />
      )}

      {/* ── ASSIGN WORK ── (admin / manager only) */}
      {tab === 'assign' && canAssign && (
        <CrudPage
          model="tasks"
          title="Assign Daily Work"
          subtitle="Admin and Managers assign work here — it appears on supervisor dashboards"
          label="Task"
          addLabel="+ Assign work"
          sort="-createdAt"
          fields={taskFields}
          columns={taskCols(false)}
          canAdd={true}
          canEdit={(r) => r.state !== 'done'}
          filters={[
            { key: 'state', label: 'All tasks', options: [{ value: 'pending', label: 'Pending' }, { value: 'done', label: 'Done' }, { value: 'overdue', label: 'Overdue' }], toQuery: (v) => (v === 'overdue' ? { overdue: '1' } : { state: v }) },
          ]}
          rowClass={(r) => (r.state !== 'done' && r.dueDate < today ? 'bg-red-50/50' : '')}
          rowActions={rowActionsForTask}
          onSaved={() => {}}
        />
      )}

      {/* ── ONGOING PROJECTS ── */}
      {tab === 'ongoing' && (
        <CrudPage
          model="tasks"
          title="Ongoing Projects"
          subtitle="All pending tasks and projects — including overdue ones"
          label="Task"
          addLabel="+ New project / task"
          baseQuery={{ state: 'pending' }}
          sort="dueDate"
          fields={taskFields}
          columns={taskCols(false)}
          canAdd={canAssign}
          canEdit={(r) => canAssign && r.state !== 'done'}
          filters={[
            { key: 'priority', label: 'All priority', options: [{ value: 'High', label: 'High priority' }, { value: 'Project', label: 'Projects' }, { value: 'Normal', label: 'Normal' }] },
          ]}
          rowClass={(r) => (r.dueDate < today ? 'bg-red-50/50' : '')}
          rowActions={rowActionsForTask}
          emptyText="No ongoing tasks — all work is done! ✔"
          onSaved={() => {}}
        />
      )}

      {/* ── COMPLETED PROJECTS ── */}
      {tab === 'completed' && (
        <CrudPage
          model="tasks"
          title="Completed Work"
          subtitle="Tasks and projects marked as done"
          label="Task"
          baseQuery={{ state: 'done' }}
          sort="-dueDate"
          fields={taskFields}
          columns={taskCols(true)}
          canAdd={false}
          canEdit={() => false}
          allowVoid={false}
          emptyText="No completed tasks yet"
          facets={{ by: 'state' }}
          summary={(rows, { facets: f }) => (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Completed" value={f?.total ?? 0} tone="green" />
            </div>
          )}
        />
      )}

      {/* Mark-done sheet */}
      <Sheet open={!!doneRow} onClose={() => setDoneRow(null)} title={`Done: ${doneRow?.title || ''}`}
        footer={<>
          <button className="btn-outline flex-1" onClick={() => setDoneRow(null)}><T>Cancel</T></button>
          <button className="btn-green flex-[2]" onClick={() => markDone(doneRow, doneRow?.reload)}><T>Mark done ✔</T></button>
        </>}>
        <div className="space-y-3">
          <Field label="What was done? (optional note)">
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Brief summary of the work completed" />
          </Field>
        </div>
      </Sheet>
    </RoleGuard>
  );
}
