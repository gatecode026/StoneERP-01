'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from '@/lib/toast';
import {
  CheckCircle2,
  Clock,
  FolderOpen,
  FolderCheck,
  Users,
  AlertTriangle,
  Plus,
  ClipboardList,
  FolderKanban,
  UserCheck,
  UserX,
  FileText,
  Calendar,
  Send,
  Sparkles,
  Layers,
  ArrowRight,
  TrendingUp,
  Boxes
} from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, PageHeader, StatCard, Section, Sheet, Field, SkeletonList, cx } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api } from '@/lib/client';
import { fmtDate, todayISO } from '@/lib/format';
import T from '@/components/T';

// ─── Supervisor Dashboard ────────────────────────────────────────────────────
// Specifically engineered for stone quarrying, cutting, and project execution:
//  1. Today's Work: Tasks assigned to the team for today
//  2. Team Attendance: Supervisor marks Present / Absent / Half-day / Leave for their 4-5 assigned workers
//  3. My Projects: Overview of stone projects assigned to this supervisor
//  4. Daily Narration: Supervisor logs daily work progress & narration tied to the project
//  5. Assign Work: Admin/Manager work assignment
//  6. Completed Work: Historical log
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

  // Active supervisor code: if logged in as supervisor, lock to their empCode; otherwise default to EMP-0001
  const mySupervisorCode = session?.empCode;
  const isOwnerOrManager = ['owner', 'manager', 'admin'].includes(session?.role);
  const [selectedSupCode, setSelectedSupCode] = useState(mySupervisorCode || 'EMP-0001');

  useEffect(() => {
    if (mySupervisorCode) setSelectedSupCode(mySupervisorCode);
  }, [mySupervisorCode]);

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
      setDoneRow(null);
      setNote('');
      reload?.();
    } catch (e) {
      toast.error(e.message);
    }
  }

  const taskFields = [
    { name: 'title', label: 'Work / Task', required: true, wide: true, placeholder: 'e.g. Cut 350 sq ft Mandana 25mm tiles' },
    { name: 'details', label: 'Details / Instructions', type: 'textarea', wide: true, placeholder: 'Machine lines, dimensions, edge chamfer, packaging specs' },
    {
      name: 'projectId',
      label: 'Linked Project',
      type: 'ref',
      ref: {
        model: 'projects',
        valueKey: '_id',
        nameField: 'projectName',
        label: (p) => `${p.name} (${p.projectCode})`,
      },
    },
    {
      name: 'assignedCode',
      label: 'Assign to (Worker / Supervisor)',
      type: 'ref',
      required: true,
      ref: {
        model: 'employees',
        valueKey: 'empCode',
        nameField: 'assignedName',
        label: (e) => `${e.name} (${e.job} · ${e.empCode})`,
        query: { status: 'active' },
      },
    },
    { name: 'dueDate', label: 'Due date', type: 'date', required: true },
    { name: 'priority', label: 'Priority', type: 'select', options: ['Normal', 'High', 'Project'], default: 'Normal' },
  ];

  const taskCols = (showDone) => [
    {
      key: 'title',
      label: 'Work',
      primary: true,
      render: (r) => (
        <span>
          <span className="font-semibold text-char-900">{r.title}</span>
          {r.priority === 'High' && <Badge tone="red" className="ml-1.5 !text-[10px]">High</Badge>}
          {r.priority === 'Project' && <Badge tone="blue" className="ml-1.5 !text-[10px]">Project</Badge>}
          <div className="text-[11px] text-char-500 font-normal mt-0.5">{r.details}</div>
        </span>
      ),
    },
    {
      key: 'projectName',
      label: 'Project',
      render: (r) =>
        r.projectName ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-terra">
            <FolderKanban size={13} />
            <span>{r.projectName}</span>
          </span>
        ) : (
          <span className="text-char-400 text-xs">—</span>
        ),
    },
    { key: 'assignedName', label: 'Worker / Team' },
    {
      key: 'dueDate',
      label: 'Due',
      render: (r) => (
        <span className={r.state !== 'done' && r.dueDate < today ? 'text-red-600 font-bold' : ''}>
          {fmtDate(r.dueDate)}
        </span>
      ),
    },
    {
      key: 'state',
      label: 'Status',
      render: (r) =>
        r.state === 'done' ? (
          <Badge tone="green">Done ✔</Badge>
        ) : r.dueDate < today ? (
          <Badge tone="red">Overdue</Badge>
        ) : (
          <Badge tone="amber">Pending</Badge>
        ),
    },
    ...(showDone ? [{ key: 'doneNote', label: 'Done note', render: (r) => r.doneNote || '—' }] : []),
  ];

  const rowActionsForTask = (row, { reload }) => {
    const actions = [];
    if (row.state !== 'done') {
      actions.push({
        label: 'Mark done',
        tone: 'green',
        icon: <CheckCircle2 size={14} />,
        onClick: () => setDoneRow({ ...row, reload }),
      });
    }
    return actions;
  };

  return (
    <RoleGuard perm="tasks">
      <PageHeader
        title="Supervisor Dashboard"
        subtitle="Team Attendance · Stone Projects · Daily Work & Progress"
      />

      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Pending Tasks" value={pendingCount} tone={pendingCount > 0 ? 'amber' : 'green'} />
        <StatCard label="Overdue" value={overdueCount} tone={overdueCount > 0 ? 'red' : 'green'} />
        <StatCard label="Today's Tasks" value={todayTasks.data?.total ?? '…'} />
        <StatCard label="Completed" value={doneTasks.data?.total ?? '…'} tone="green" />
      </div>

      {overdueCount > 0 && (
        <div className="mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 flex items-center gap-2">
          <AlertTriangle size={15} />
          <span><b>{overdueCount} overdue tasks.</b> Review them under "Ongoing" or mark as completed.</span>
        </div>
      )}

      {/* Main Tabs */}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'today', label: "Today's Work" },
          { key: 'attendance', label: 'Team Attendance' },
          { key: 'my_projects', label: 'My Projects' },
          { key: 'narration', label: 'Daily Narration' },
          { key: 'assign', label: canAssign ? 'Assign Work' : null },
          { key: 'ongoing', label: 'All Ongoing' },
          { key: 'completed', label: 'Completed' },
        ].filter((t) => t.label)}
      />

      {/* ── 1. TODAY'S WORK ── */}
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
        />
      )}

      {/* ── 2. TEAM ATTENDANCE (Supervisor marks attendance for their workers) ── */}
      {tab === 'attendance' && (
        <SupervisorTeamAttendance
          selectedSupCode={selectedSupCode}
          setSelectedSupCode={setSelectedSupCode}
          isOwnerOrManager={isOwnerOrManager}
        />
      )}

      {/* ── 3. MY PROJECTS ── */}
      {tab === 'my_projects' && (
        <SupervisorProjectsView
          selectedSupCode={selectedSupCode}
          setSelectedSupCode={setSelectedSupCode}
          isOwnerOrManager={isOwnerOrManager}
        />
      )}

      {/* ── 4. DAILY WORK NARRATION & PROGRESS ── */}
      {tab === 'narration' && (
        <SupervisorDailyNarration
          selectedSupCode={selectedSupCode}
          session={session}
        />
      )}

      {/* ── 5. ASSIGN WORK (Admin / Managers) ── */}
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
            {
              key: 'state',
              label: 'All tasks',
              options: [
                { value: 'pending', label: 'Pending' },
                { value: 'done', label: 'Done' },
                { value: 'overdue', label: 'Overdue' },
              ],
              toQuery: (v) => (v === 'overdue' ? { overdue: '1' } : { state: v }),
            },
          ]}
          rowClass={(r) => (r.state !== 'done' && r.dueDate < today ? 'bg-red-50/50' : '')}
          rowActions={rowActionsForTask}
        />
      )}

      {/* ── 6. ALL ONGOING ── */}
      {tab === 'ongoing' && (
        <CrudPage
          model="tasks"
          title="Ongoing Projects & Work"
          subtitle="All pending tasks and projects across the factory and sites"
          label="Task"
          addLabel="+ New project / task"
          baseQuery={{ state: 'pending' }}
          sort="dueDate"
          fields={taskFields}
          columns={taskCols(false)}
          canAdd={canAssign}
          canEdit={(r) => canAssign && r.state !== 'done'}
          filters={[
            {
              key: 'priority',
              label: 'All priority',
              options: [
                { value: 'High', label: 'High priority' },
                { value: 'Project', label: 'Projects' },
                { value: 'Normal', label: 'Normal' },
              ],
            },
          ]}
          rowClass={(r) => (r.dueDate < today ? 'bg-red-50/50' : '')}
          rowActions={rowActionsForTask}
          emptyText="No ongoing tasks — all work is up to date! ✔"
        />
      )}

      {/* ── 7. COMPLETED WORK ── */}
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
        />
      )}

      {/* Mark-done confirmation sheet */}
      <Sheet
        open={!!doneRow}
        onClose={() => setDoneRow(null)}
        title={`Complete Work: ${doneRow?.title || ''}`}
        footer={
          <>
            <button className="btn-outline flex-1" onClick={() => setDoneRow(null)}>
              <T>Cancel</T>
            </button>
            <button className="btn-green flex-[2]" onClick={() => markDone(doneRow, doneRow?.reload)}>
              <T>Mark Done ✔</T>
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="What was completed? (narration / note)">
            <textarea
              className="input"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Completed 350 sq ft cutting on Gang Saw 1; crated into Box #4"
            />
          </Field>
        </div>
      </Sheet>
    </RoleGuard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT 1: Team Attendance (Supervisor marks Present/Absent for their crew)
// ─────────────────────────────────────────────────────────────────────────────
function SupervisorTeamAttendance({ selectedSupCode, setSelectedSupCode, isOwnerOrManager }) {
  const [date, setDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [attMap, setAttMap] = useState({}); // empCode -> state ('present', 'absent', 'half', 'leave')

  // 1. Fetch supervisors list (for admin switcher)
  const supervisorsList = useFetch(isOwnerOrManager ? '/api/employees?job=Supervisor&limit=30' : null);
  const supervisors = (supervisorsList.data?.data || supervisorsList.data || []);

  // 2. Fetch workers assigned to this supervisor
  const teamUrl = `/api/employees?supervisorCode=${selectedSupCode}&status=active&limit=100`;
  const teamRes = useFetch(teamUrl, [selectedSupCode]);
  const workers = teamRes.data?.data || teamRes.data || [];

  // 3. Fetch attendance for this date
  const attRes = useFetch(`/api/attendance?date=${date}&limit=200`, [date]);
  const attendanceRows = attRes.data?.data || attRes.data || [];

  useEffect(() => {
    const map = {};
    attendanceRows.forEach((a) => {
      if (a.empCode) map[a.empCode] = a.state;
    });
    setAttMap(map);
  }, [attendanceRows]);

  // Mark single worker
  async function markWorker(empCode, state) {
    setAttMap((prev) => ({ ...prev, [empCode]: state }));
    try {
      await api('/api/attendance', {
        method: 'POST',
        body: { date, empCode, state },
      });
      toast.success(`${empCode} marked ${state}`);
    } catch (e) {
      toast.error(e.message || 'Failed to update attendance');
      attRes.reload?.();
    }
  }

  // Mark all workers in team present in one click
  async function markAllPresent() {
    if (!workers.length) return;
    setSaving(true);
    const updated = { ...attMap };
    workers.forEach((w) => {
      updated[w.empCode] = 'present';
    });
    setAttMap(updated);

    let ok = 0;
    for (const w of workers) {
      try {
        await api('/api/attendance', {
          method: 'POST',
          body: { date, empCode: w.empCode, state: 'present' },
        });
        ok++;
      } catch {
        // continue
      }
    }
    setSaving(false);
    toast.success(`Marked ${ok} of ${workers.length} workers present ✔`);
    attRes.reload?.();
  }

  const presentCount = workers.filter((w) => attMap[w.empCode] === 'present').length;
  const absentCount = workers.filter((w) => attMap[w.empCode] === 'absent').length;
  const halfCount = workers.filter((w) => attMap[w.empCode] === 'half').length;
  const unmarkedCount = workers.length - (presentCount + absentCount + halfCount);

  return (
    <div className="space-y-4">
      {/* Control bar: Supervisor switcher (if admin), Date picker, Mark All button */}
      <div className="card p-4 flex flex-wrap items-center justify-between gap-3 bg-white border border-sand-200">
        <div className="flex flex-wrap items-center gap-2.5">
          {isOwnerOrManager && supervisors.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-char-600">Supervisor:</span>
              <select
                className="input !w-auto text-xs font-semibold py-1.5"
                value={selectedSupCode}
                onChange={(e) => setSelectedSupCode(e.target.value)}
              >
                {supervisors.map((s) => (
                  <option key={s.empCode} value={s.empCode}>
                    {s.name} ({s.empCode})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <Calendar size={15} className="text-char-500" />
            <input
              type="date"
              className="input !w-auto text-xs py-1.5"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-green text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-sm"
            onClick={markAllPresent}
            disabled={saving || workers.length === 0}
          >
            <CheckCircle2 size={14} />
            <span>Mark All Present ({workers.length})</span>
          </button>
        </div>
      </div>

      {/* Summary Chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="card p-3 bg-sand-50 border border-sand-200 text-center">
          <div className="text-[11px] font-medium text-char-500">Team Strength</div>
          <div className="text-xl font-bold text-char-900">{workers.length}</div>
        </div>
        <div className="card p-3 bg-emerald-50 border border-emerald-200 text-center">
          <div className="text-[11px] font-medium text-emerald-800">Present</div>
          <div className="text-xl font-bold text-emerald-700">{presentCount}</div>
        </div>
        <div className="card p-3 bg-rose-50 border border-rose-200 text-center">
          <div className="text-[11px] font-medium text-rose-800">Absent</div>
          <div className="text-xl font-bold text-rose-700">{absentCount}</div>
        </div>
        <div className="card p-3 bg-amber-50 border border-amber-200 text-center">
          <div className="text-[11px] font-medium text-amber-800">Unmarked</div>
          <div className="text-xl font-bold text-amber-700">{unmarkedCount}</div>
        </div>
      </div>

      {/* Worker List Table */}
      {teamRes.loading ? (
        <SkeletonList n={5} className="h-16" />
      ) : workers.length === 0 ? (
        <div className="card p-8 text-center text-char-500 bg-white">
          <Users size={32} className="mx-auto text-char-300 mb-2" />
          <p className="font-semibold">No workers assigned to this supervisor yet.</p>
          <p className="text-xs text-char-400 mt-1">
            Workers can be assigned under supervisor in the Employees module.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden bg-white border border-sand-200 shadow-sm">
          <div className="px-4 py-3 border-b border-sand-200 bg-sand-50/70 flex items-center justify-between">
            <span className="text-xs font-bold text-char-700 uppercase tracking-wider">
              Assigned Workers ({workers.length})
            </span>
            <span className="text-xs text-char-500">Click a button to mark or update</span>
          </div>

          <div className="divide-y divide-sand-200">
            {workers.map((w) => {
              const current = attMap[w.empCode] || '';
              return (
                <div
                  key={w._id}
                  className={cx(
                    'p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors',
                    current === 'present'
                      ? 'bg-emerald-50/30'
                      : current === 'absent'
                      ? 'bg-rose-50/30'
                      : current === 'half'
                      ? 'bg-amber-50/30'
                      : 'hover:bg-sand-50'
                  )}
                >
                  {/* Worker details */}
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-terra-100 text-terra-800 font-bold flex items-center justify-center text-sm shrink-0">
                      {w.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold text-char-900 text-sm">
                        {w.name}
                        <span className="ml-2 text-xs font-normal text-char-500">{w.empCode}</span>
                      </div>
                      <div className="text-xs text-char-500">
                        {w.job} {w.mobile ? `· ${w.mobile}` : ''}
                      </div>
                    </div>
                  </div>

                  {/* Attendance Toggle Buttons */}
                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => markWorker(w.empCode, 'present')}
                      className={cx(
                        'text-xs px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1',
                        current === 'present'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-white border border-sand-300 text-char-700 hover:border-emerald-500 hover:text-emerald-700'
                      )}
                    >
                      <UserCheck size={13} /> Present
                    </button>

                    <button
                      type="button"
                      onClick={() => markWorker(w.empCode, 'absent')}
                      className={cx(
                        'text-xs px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1',
                        current === 'absent'
                          ? 'bg-rose-600 text-white shadow-xs'
                          : 'bg-white border border-sand-300 text-char-700 hover:border-rose-500 hover:text-rose-700'
                      )}
                    >
                      <UserX size={13} /> Absent
                    </button>

                    <button
                      type="button"
                      onClick={() => markWorker(w.empCode, 'half')}
                      className={cx(
                        'text-xs px-2.5 py-1.5 rounded-lg font-semibold transition-all',
                        current === 'half'
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'bg-white border border-sand-300 text-char-700 hover:border-amber-500 hover:text-amber-700'
                      )}
                    >
                      Half Day
                    </button>

                    <button
                      type="button"
                      onClick={() => markWorker(w.empCode, 'leave')}
                      className={cx(
                        'text-xs px-2.5 py-1.5 rounded-lg font-semibold transition-all',
                        current === 'leave'
                          ? 'bg-purple-600 text-white shadow-xs'
                          : 'bg-white border border-sand-300 text-char-700 hover:border-purple-500 hover:text-purple-700'
                      )}
                    >
                      Leave
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT 2: Supervisor Projects View
// ─────────────────────────────────────────────────────────────────────────────
function SupervisorProjectsView({ selectedSupCode, setSelectedSupCode, isOwnerOrManager }) {
  const prjRes = useFetch('/api/projects?limit=50', [selectedSupCode]);
  const projects = prjRes.data?.data || prjRes.data || [];

  // Filter projects for selected supervisor or show all if admin requested
  const filtered = isOwnerOrManager
    ? projects
    : projects.filter((p) => p.supervisorCode === selectedSupCode);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold text-base text-char-900">
          Assigned Projects ({filtered.length})
        </h3>
        <Link href="/projects" className="text-xs font-semibold text-terra hover:underline flex items-center gap-1">
          <span>Open Full Projects Module</span>
          <ArrowRight size={13} />
        </Link>
      </div>

      {prjRes.loading ? (
        <SkeletonList n={3} className="h-40" />
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-char-500 bg-white">
          <FolderKanban size={32} className="mx-auto text-char-300 mb-2" />
          <p className="font-semibold">No stone projects currently assigned to this supervisor.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((p) => {
            const taskPct = p.taskCount ? Math.round(((p.tasksDone || 0) / p.taskCount) * 100) : 0;
            return (
              <div key={p._id} className="card p-4.5 bg-white border border-sand-200 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[11px] font-bold tracking-wider text-terra uppercase">
                        {p.projectCode}
                      </span>
                      <h4 className="font-bold text-base text-char-900 leading-snug">{p.name}</h4>
                      <p className="text-xs text-char-500 mt-0.5">{p.clientName} · {p.site}</p>
                    </div>
                    <Badge tone={p.status === 'Completed' ? 'green' : 'terra'}>{p.status}</Badge>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs bg-sand-50/70 p-2.5 rounded-xl border border-sand-200">
                    <div>
                      <span className="text-[10px] uppercase text-char-400 font-semibold block">Stone Variety</span>
                      <span className="font-semibold text-char-800">{p.stoneType || 'Mandana/Kota'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-char-400 font-semibold block">Target Qty</span>
                      <span className="font-semibold text-char-800">{p.targetQty || '—'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-char-400 font-semibold block">Supervisor</span>
                      <span className="font-semibold text-terra">{p.supervisorName || p.supervisorCode}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-char-400 font-semibold block">Target Date</span>
                      <span className="font-semibold text-char-800">{fmtDate(p.targetDate)}</span>
                    </div>
                  </div>

                  {/* Deliverables snippet */}
                  {p.deliverables && (
                    <div className="mt-3">
                      <span className="text-[11px] font-bold text-char-700 block">Deliverables & Specs:</span>
                      <p className="text-xs text-char-600 line-clamp-2 mt-0.5 whitespace-pre-line">
                        {p.deliverables}
                      </p>
                    </div>
                  )}

                  {/* Requirements snippet */}
                  {p.requirements && (
                    <div className="mt-2.5">
                      <span className="text-[11px] font-bold text-char-700 block">What It Needs:</span>
                      <p className="text-xs text-char-600 line-clamp-2 mt-0.5 whitespace-pre-line">
                        {p.requirements}
                      </p>
                    </div>
                  )}
                </div>

                {/* Progress bar */}
                <div className="mt-4 pt-3 border-t border-sand-200">
                  <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
                    <span className="text-char-600">Work Execution Progress</span>
                    <span className="font-bold text-char-900">{taskPct}% ({p.tasksDone || 0}/{p.taskCount || 0} tasks)</span>
                  </div>
                  <div className="w-full bg-sand-200 h-2 rounded-full overflow-hidden">
                    <div className="bg-terra h-full transition-all duration-300 rounded-full" style={{ width: `${taskPct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT 3: Supervisor Daily Work Narration & Progress Form
// ─────────────────────────────────────────────────────────────────────────────
function SupervisorDailyNarration({ selectedSupCode, session }) {
  const [form, setForm] = useState({
    date: todayISO(),
    projectId: '',
    narration: '',
    hours: 8,
    quantity: '',
    problem: '',
    plan: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // Projects list for dropdown
  const prjRes = useFetch('/api/projects?limit=50');
  const projects = prjRes.data?.data || prjRes.data || [];

  // Recent daily reports
  const reportsRes = useFetch(`/api/dailyreports?empCode=${selectedSupCode}&limit=10`, [submitting]);
  const reports = reportsRes.data?.data || reportsRes.data || [];

  async function submitReport(e) {
    e.preventDefault();
    if (!form.narration.trim()) {
      toast.error('Please enter work narration (what was done today)');
      return;
    }
    setSubmitting(true);
    try {
      const selectedPrj = projects.find((p) => p._id === form.projectId);
      await api('/api/dailyreports', {
        method: 'POST',
        body: {
          ...form,
          empCode: selectedSupCode,
          hours: Number(form.hours) || 8,
          quantity: Number(form.quantity) || 0,
          projectCode: selectedPrj?.projectCode,
          projectName: selectedPrj?.name,
        },
      });
      toast.success('Daily progress narration submitted ✔');
      setForm({
        date: todayISO(),
        projectId: '',
        narration: '',
        hours: 8,
        quantity: '',
        problem: '',
        plan: '',
      });
      reportsRes.reload?.();
    } catch (err) {
      toast.error(err.message || 'Failed to submit daily report');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Narration Form */}
      <div className="card p-5 bg-white border border-sand-200 shadow-sm">
        <div className="pb-3 mb-4 border-b border-sand-200 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base text-char-900 flex items-center gap-2">
              <FileText size={17} className="text-terra" />
              <span>Log Today's Work & Progress (Narration)</span>
            </h3>
            <p className="text-xs text-char-500 mt-0.5">
              Submit daily stone cutting, calibration, and dispatch progress linked to active projects
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-sand-100 text-char-700">
            Supervisor: {selectedSupCode}
          </span>
        </div>

        <form onSubmit={submitReport} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="Date" required>
              <input
                type="date"
                className="input"
                value={form.date}
                max={todayISO()}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </Field>

            <Field label="Linked Project">
              <select
                className="input"
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
              >
                <option value="">Select Stone Project…</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} ({p.projectCode})
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Work Done Today (Narration)" required hint="Describe slabs cut, machines run, quality checks, crates packed">
            <textarea
              className="input"
              rows={3}
              value={form.narration}
              onChange={(e) => setForm({ ...form, narration: e.target.value })}
              placeholder="e.g. Cut 350 sq ft Mandana 25mm tiles on Gangsaw 1. Transferred to edge calibration. Packed crates #1 to #8."
              required
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="Hours Worked">
              <input
                type="number"
                step="0.5"
                className="input"
                value={form.hours}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
              />
            </Field>

            <Field label="Output Quantity (Sq.Ft / Tonnes / Pcs)">
              <input
                type="number"
                className="input"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                placeholder="e.g. 350"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="Problems / Obstacles Faced (optional)">
              <input
                type="text"
                className="input"
                value={form.problem}
                onChange={(e) => setForm({ ...form, problem: e.target.value })}
                placeholder="e.g. Water pump pressure drop between 2 PM to 3 PM"
              />
            </Field>

            <Field label="Tomorrow's Plan (optional)">
              <input
                type="text"
                className="input"
                value={form.plan}
                onChange={(e) => setForm({ ...form, plan: e.target.value })}
                placeholder="e.g. Continue bullnose chamfering on 150 treads"
              />
            </Field>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="btn-primary flex items-center gap-2 py-2 px-5 font-semibold shadow-sm"
              disabled={submitting}
            >
              <Send size={15} />
              <span>{submitting ? 'Submitting…' : 'Submit Progress Narration'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Recent Submissions */}
      <div className="space-y-3">
        <h4 className="font-bold text-sm text-char-800 uppercase tracking-wider">
          Recent Daily Progress Reports ({reports.length})
        </h4>

        {reportsRes.loading ? (
          <SkeletonList n={3} className="h-20" />
        ) : reports.length === 0 ? (
          <div className="card p-6 text-center text-char-400 bg-white">
            No daily progress reports recorded for this supervisor yet.
          </div>
        ) : (
          <div className="space-y-2.5">
            {reports.map((r) => (
              <div key={r._id} className="card p-3.5 bg-white border border-sand-200">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-char-900">{fmtDate(r.date)}</span>
                    {r.projectName && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-terra bg-terra-50 px-2 py-0.5 rounded-md border border-terra-200">
                        <FolderKanban size={11} /> {r.projectName}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-char-500 font-medium">
                    {r.hours ? `${r.hours} hrs` : ''} {r.quantity ? `· ${r.quantity} sq ft` : ''}
                  </span>
                </div>
                <p className="text-xs text-char-700 mt-1.5 whitespace-pre-line">{r.narration}</p>
                {r.problem && (
                  <div className="mt-1.5 text-[11px] text-red-600 bg-red-50/60 px-2 py-1 rounded">
                    <b>Problem:</b> {r.problem}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
