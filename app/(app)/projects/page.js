'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  FolderKanban, CheckCircle2, Clock, AlertTriangle, Plus, ListChecks,
  User, Calendar, Layers, Hammer, ShieldAlert, CheckSquare, Sparkles,
  ExternalLink, FileText, PackageCheck, Briefcase
} from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import ImportData from '@/components/ImportData';
import { RoleGuard, Badge, Sheet, StatCard, KV } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { fmtDate, todayISO, inr } from '@/lib/format';
import { api } from '@/lib/client';
import toast from '@/lib/toast';
import T from '@/components/T';

const STONE_VARIETIES = [
  'Teakwood Sandstone',
  'Kandla Grey Sandstone',
  'Rainbow Sandstone',
  'Black Granite',
  'Kota Stone',
  'White Marble',
  'Jodhpur Pink Sandstone',
  'Dholpur Beige Sandstone',
  'Cobbles & Pavers',
  'Custom Architectural Stone',
];

const SITE_OPTIONS = ['Factory', 'Yard', 'Quarry', 'Office', 'Gate', 'On-site Installation'];
const STATUS_OPTIONS = ['In Progress', 'Completed', 'Pending', 'Planning', 'On Hold', 'Review'];
const PRIORITY_OPTIONS = ['Normal', 'High', 'Urgent'];

export default function ProjectsPage() {
  const { t, tr, can, session } = useApp();
  const sp = useSearchParams();
  const today = todayISO();

  // Selected project for viewing details and tasks
  const [selectedProject, setSelectedProject] = useState(null);

  // New task assignment modal for selected project
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({
    title: '',
    details: '',
    assignedCode: '',
    dueDate: todayISO(),
    priority: 'Normal',
  });
  const [taskBusy, setTaskBusy] = useState(false);

  // Fetch supervisors and operators for project task assignment dropdown
  const assigneesFetch = useFetch('/api/employees?job=Supervisor,Operator&status=active&limit=100');
  const assignees = assigneesFetch.data?.rows || assigneesFetch.data || [];
  const supervisorsList = assignees.filter((a) => a.job?.toLowerCase() === 'supervisor');
  const operatorsList = assignees.filter((a) => a.job?.toLowerCase() === 'operator');

  // Fetch tasks linked to selected project
  const projectTasksFetch = useFetch(
    selectedProject ? `/api/tasks?projectId=${selectedProject._id}&limit=100` : null,
    [selectedProject?._id]
  );
  const projectTasks = projectTasksFetch.data?.rows || projectTasksFetch.data || [];

  // Stats
  const statsFetch = useFetch('/api/projects?limit=200');
  const allProjects = statsFetch.data?.rows || statsFetch.data || [];
  const inProgressCount = allProjects.filter((p) => p.status === 'In Progress').length;
  const highPriorityCount = allProjects.filter((p) => p.priority === 'High' || p.priority === 'Urgent').length;
  const completedCount = allProjects.filter((p) => p.status === 'Completed').length;
  const pendingCount = allProjects.filter((p) => p.status === 'Pending' || p.status === 'Planning' || p.status === 'On Hold').length;

  const canManage = can('projects', 'create') || can('projects', 'edit') || session?.role === 'owner' || session?.role === 'manager';

  async function handleAssignTaskToProject(e) {
    e?.preventDefault?.();
    if (!taskForm.title.trim() || !taskForm.assignedCode || !taskForm.dueDate) {
      toast.error('Please enter task title, assignee, and due date');
      return;
    }
    setTaskBusy(true);
    try {
      await api('/api/tasks', {
        method: 'POST',
        body: {
          ...taskForm,
          projectId: String(selectedProject._id),
          projectCode: selectedProject.projectCode,
          projectName: selectedProject.name,
        },
      });
      toast.success(`Task assigned for ${selectedProject.name}`);
      setTaskModalOpen(false);
      setTaskForm({ title: '', details: '', assignedCode: '', dueDate: todayISO(), priority: 'Normal' });
      projectTasksFetch.reload();
      statsFetch.reload();
    } catch (err) {
      toast.error(err.message);
    }
    setTaskBusy(false);
  }

  const fields = [
    { name: 'name', label: 'Project Name', required: true, wide: true, placeholder: 'e.g. Airport Terminal 3 - Sandstone Cladding' },
    { name: 'clientName', label: 'Client / Customer', placeholder: 'e.g. L&T Infrastructure, Oberoi Hotels' },
    { name: 'site', label: 'Site Location', type: 'select', options: SITE_OPTIONS, default: 'Factory' },
    { name: 'stoneType', label: 'Stone Variety', type: 'select', options: STONE_VARIETIES, default: 'Teakwood Sandstone' },
    { name: 'targetQty', label: 'Target Output / Quantity', placeholder: 'e.g. 25,000 sq ft / 150 tonnes' },
    {
      name: 'supervisorCode',
      label: 'Supervisor in Charge',
      type: 'ref',
      ref: {
        model: 'employees',
        valueKey: 'empCode',
        nameField: 'supervisorName',
        label: (e) => `${e.name} (${e.empCode})`,
        query: { status: 'active', job: 'Supervisor' },
      },
    },
    { name: 'startDate', label: 'Start Date', type: 'date', default: () => todayISO() },
    { name: 'targetDate', label: 'Target Deadline', type: 'date', required: true },
    { name: 'status', label: 'Project Status', type: 'select', options: STATUS_OPTIONS, default: 'In Progress' },
    { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY_OPTIONS, default: 'Normal' },
    { name: 'contractValue', label: 'Contract Value (₹)', type: 'number', placeholder: 'Optional budget / value' },
    {
      name: 'requirements',
      label: 'What It Needs (Materials & Machines)',
      type: 'textarea',
      wide: true,
      placeholder: 'e.g. 30 Raw Quarry Blocks (Teakwood Grade A), Bridge Cutter 1 & 2 for sizing, Calibration 2 for 20mm thickness, wooden pallets',
    },
    {
      name: 'deliverables',
      label: 'Key Deliverables & Specifications',
      type: 'textarea',
      wide: true,
      placeholder: 'e.g. 1. 20mm Calibrated Honed Slabs (600x600mm) - 15,000 sqft\n2. Bullnose coping steps (1200x300mm) - 400 pcs\n3. Export fumigated crate packing',
    },
    { name: 'notes', label: 'Additional Notes', type: 'textarea', wide: true },
  ];

  const columns = [
    {
      key: 'name',
      label: 'Project',
      primary: true,
      render: (r) => (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-char-900 hover:text-terra transition-colors">{r.name}</span>
            <span className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded bg-sand-100 text-char-700 border border-sand-200">
              {r.projectCode}
            </span>
            {r.priority === 'Urgent' ? (
              <Badge tone="red">Urgent</Badge>
            ) : r.priority === 'High' ? (
              <Badge tone="amber">High</Badge>
            ) : null}
          </div>
          {r.clientName && (
            <span className="text-xs text-char-500 font-normal">
              Client: <b className="text-char-700">{r.clientName}</b>
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'stoneType',
      label: 'Stone & Target',
      render: (r) => (
        <div>
          <div className="text-xs font-semibold text-char-800">{r.stoneType || 'Stone Supply'}</div>
          {r.targetQty && <div className="text-[11px] text-char-500">{r.targetQty}</div>}
        </div>
      ),
    },
    {
      key: 'deliverables',
      label: 'Deliverables',
      wide: true,
      render: (r) => (
        <div className="max-w-[280px] text-xs text-char-700 line-clamp-2" title={r.deliverables}>
          {r.deliverables || '—'}
        </div>
      ),
    },
    {
      key: 'supervisorName',
      label: 'Supervisor',
      render: (r) => (
        <div className="flex items-center gap-1 text-xs">
          <User size={13} className="text-terra shrink-0" />
          <span className="font-medium text-char-800">{r.supervisorName || r.supervisorCode || 'Unassigned'}</span>
        </div>
      ),
    },
    {
      key: 'targetDate',
      label: 'Deadline',
      render: (r) => (
        <span
          className={`text-xs ${
            r.status !== 'Completed' && r.targetDate && r.targetDate < today ? 'text-red-600 font-bold' : 'text-char-600'
          }`}
        >
          {fmtDate(r.targetDate)}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <Badge
          tone={
            r.status === 'Completed'
              ? 'green'
              : r.status === 'In Progress'
              ? 'amber'
              : r.status === 'Review'
              ? 'purple'
              : r.status === 'On Hold'
              ? 'gray'
              : 'blue'
          }
        >
          {r.status || 'Planning'}
        </Badge>
      ),
    },
    {
      key: 'taskProgress',
      label: 'Tasks',
      render: (r) => {
        const total = r.taskCount || 0;
        const done = r.tasksDone || 0;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return (
          <div className="flex flex-col gap-1 min-w-[80px]">
            <div className="flex justify-between text-[11px] text-char-600">
              <span>{done}/{total} done</span>
              {total > 0 && <span>{pct}%</span>}
            </div>
            {total > 0 && (
              <div className="w-full bg-sand-200 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${pct === 100 ? 'bg-emerald-500' : 'bg-terra'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <RoleGuard perm="tasks">
      <div className="space-y-4">
        {/* Top Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Projects" value={allProjects.length} />
          <StatCard label="In Progress" value={inProgressCount} tone="amber" />
          <StatCard label="Pending / Planning" value={pendingCount} tone="blue" />
          <StatCard label="Completed" value={completedCount} tone="green" />
        </div>

        {/* Main Projects CrudPage */}
        <CrudPage
          model="projects"
          title="Projects & Work Deliverables"
          subtitle="Track stone projects, material requirements, deliverables, and assign supervisor tasks"
          label="Project"
          addLabel="New Project"
          headerExtra={
            <ImportData
              resource="projects"
              perm="projects"
              noun="projects"
              hint="order date, order no, party name, colour, finish, sizes, quantities and total amount"
            />
          }
          fields={fields}
          columns={columns}
          sort="-createdAt"
          pagination={25}
          filters={[
            {
              key: 'status',
              label: 'All status',
              default: 'In Progress',
              options: [
                { value: 'In Progress', label: 'In Progress' },
                { value: 'Completed', label: 'Completed' },
                { value: 'Pending', label: 'Pending' },
                { value: 'Planning', label: 'Planning' },
                { value: 'On Hold', label: 'On Hold' },
              ],
              toQuery: (v) => {
                if (v === 'Pending') return { status: 'Pending,Planning,On Hold' };
                return { status: v };
              },
            },
          ]}
          wide
          onRowClick={(row) => setSelectedProject(row)}
          rowActions={(row) => [
            {
              label: 'View Project & Tasks',
              icon: <FolderKanban size={14} className="text-terra" />,
              onClick: () => setSelectedProject(row),
            },
            {
              label: '+ Assign Task',
              icon: <Plus size={14} className="text-emerald-600" />,
              onClick: () => {
                setSelectedProject(row);
                setTaskModalOpen(true);
              },
            },
          ]}
        />

        {/* Project Detailed View Sheet */}
        <Sheet
          open={Boolean(selectedProject)}
          onClose={() => setSelectedProject(null)}
          title={selectedProject ? `${selectedProject.name} (${selectedProject.projectCode})` : 'Project Details'}
          wide
          footer={
            <div className="flex items-center justify-between w-full">
              <span className="text-xs text-char-500">
                Created: {fmtDate(selectedProject?.createdAt)}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary !text-xs !py-1.5 !px-3 flex items-center gap-1.5"
                  onClick={() => setTaskModalOpen(true)}
                >
                  <Plus size={14} /> Assign Task to this Project
                </button>
                <button
                  type="button"
                  className="btn-outline !text-xs !py-1.5 !px-3"
                  onClick={() => setSelectedProject(null)}
                >
                  Close
                </button>
              </div>
            </div>
          }
        >
          {selectedProject && (
            <div className="space-y-4">
              {/* Top metadata grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 p-3.5 rounded-xl bg-sand-50/80 border border-sand-200">
                <KV label="Client">{selectedProject.clientName || 'Direct Order'}</KV>
                <KV label="Stone Variety">{selectedProject.stoneType || 'Custom'}</KV>
                <KV label="Target Quantity">{selectedProject.targetQty || '—'}</KV>
                <KV label="Site / Yard">{selectedProject.site || 'Factory'}</KV>
                <KV label="Supervisor in Charge">
                  <span className="font-semibold text-terra">
                    {selectedProject.supervisorName || selectedProject.supervisorCode || 'Unassigned'}
                  </span>
                </KV>
                <KV label="Target Deadline">
                  <span className={selectedProject.targetDate < today && selectedProject.status !== 'Completed' ? 'text-red-600 font-bold' : ''}>
                    {fmtDate(selectedProject.targetDate)}
                  </span>
                </KV>
                <KV label="Status">
                  <Badge tone={selectedProject.status === 'Completed' ? 'green' : 'amber'}>
                    {selectedProject.status}
                  </Badge>
                </KV>
                <KV label="Priority">
                  <Badge tone={selectedProject.priority === 'Urgent' ? 'red' : 'gray'}>
                    {selectedProject.priority}
                  </Badge>
                </KV>
                {selectedProject.contractValue > 0 && (
                  <KV label="Contract Value">{inr(selectedProject.contractValue)}</KV>
                )}
              </div>

              {/* What It Needs & Deliverables Split */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* Requirements / Needs */}
                <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/40">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5 mb-2">
                    <Layers size={14} className="text-amber-700" />
                    What It Needs (Raw Materials, Blocks & Machines)
                  </h3>
                  <div className="text-xs text-char-800 whitespace-pre-wrap leading-relaxed">
                    {selectedProject.requirements || 'No specific raw material or machine requirements recorded.'}
                  </div>
                </div>

                {/* Deliverables */}
                <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-900 flex items-center gap-1.5 mb-2">
                    <PackageCheck size={14} className="text-emerald-700" />
                    Key Deliverables & Specifications
                  </h3>
                  <div className="text-xs text-char-800 whitespace-pre-wrap leading-relaxed">
                    {selectedProject.deliverables || 'No specific deliverables specified.'}
                  </div>
                </div>
              </div>

              {/* Linked Tasks Section */}
              <div className="pt-2 border-t border-sand-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ListChecks size={16} className="text-terra" />
                    <h3 className="text-sm font-bold text-char-900">
                      Tasks Assigned Under this Project ({projectTasks.length})
                    </h3>
                  </div>
                  <button
                    type="button"
                    className="btn-outline !text-xs !py-1 !px-2.5 flex items-center gap-1"
                    onClick={() => setTaskModalOpen(true)}
                  >
                    <Plus size={13} /> Add Task
                  </button>
                </div>

                {projectTasksFetch.loading ? (
                  <div className="p-4 text-center text-xs text-char-500">Loading project tasks…</div>
                ) : projectTasks.length === 0 ? (
                  <div className="p-4 text-center rounded-xl bg-sand-50 border border-dashed border-sand-300 text-xs text-char-600">
                    No tasks assigned to this project yet. Click &quot;Add Task&quot; above to give work to supervisors.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {projectTasks.map((t) => (
                      <div
                        key={t._id}
                        className="p-3 rounded-xl bg-white border border-sand-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-char-900">{t.title}</span>
                            {t.priority === 'High' && <Badge tone="red">High</Badge>}
                            {t.state === 'done' ? (
                              <Badge tone="green">Done ✔</Badge>
                            ) : t.dueDate < today ? (
                              <Badge tone="red">Overdue</Badge>
                            ) : (
                              <Badge tone="amber">Pending</Badge>
                            )}
                          </div>
                          {t.details && <div className="text-[11px] text-char-500">{t.details}</div>}
                          {t.doneNote && (
                            <div className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium">
                              Completion note: {t.doneNote}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-xs text-char-600">
                          <div className="flex items-center gap-1">
                            <User size={12} className="text-char-400" />
                            <span>{t.assignedName}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar size={12} className="text-char-400" />
                            <span>Due: {fmtDate(t.dueDate)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Sheet>

        {/* Quick Assign Task Modal for Project */}
        <Sheet
          open={taskModalOpen}
          onClose={() => setTaskModalOpen(false)}
          title={tr('Assign Task – {project}', { project: selectedProject?.name || 'Project' })}
          footer={
            <>
              <button
                type="button"
                className="btn-outline"
                onClick={() => setTaskModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleAssignTaskToProject}
                disabled={taskBusy}
              >
                {taskBusy ? 'Assigning…' : 'Assign Task'}
              </button>
            </>
          }
        >
          <form onSubmit={handleAssignTaskToProject} className="space-y-3.5">
            <div>
              <label className="label">Task Title *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Cut 20mm slabs on Bridge Cutter 1 as per template"
                value={taskForm.title}
                onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Work Details & Instructions</label>
              <textarea
                className="input !h-24"
                placeholder="Specify dimensions, tolerances, quality checks, machine lines to use..."
                value={taskForm.details}
                onChange={(e) => setTaskForm({ ...taskForm, details: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Assign to (Supervisor / Operator) *</label>
                <select
                  className="input"
                  value={taskForm.assignedCode}
                  onChange={(e) => setTaskForm({ ...taskForm, assignedCode: e.target.value })}
                  required
                >
                  <option value="">Choose Assignee…</option>
                  {supervisorsList.length > 0 && (
                    <optgroup label="── Supervisors ──">
                      {supervisorsList.map((s) => (
                        <option key={s.empCode} value={s.empCode}>
                          {s.name} ({s.empCode} · Supervisor)
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {operatorsList.length > 0 && (
                    <optgroup label="── Machine Operators ──">
                      {operatorsList.map((o) => (
                        <option key={o.empCode} value={o.empCode}>
                          {o.name} ({o.empCode} · Operator)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div>
                <label className="label">Due Date *</label>
                <input
                  type="date"
                  className="input"
                  value={taskForm.dueDate}
                  onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })}
                  required
                />
              </div>
            </div>
            <div>
              <label className="label">Priority</label>
              <select
                className="input"
                value={taskForm.priority}
                onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
              >
                <option value="Normal">Normal</option>
                <option value="High">High</option>
              </select>
            </div>
          </form>
        </Sheet>
      </div>
    </RoleGuard>
  );
}
