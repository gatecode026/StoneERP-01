'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  FolderKanban, CheckCircle2, Clock, AlertTriangle, Plus, ListChecks,
  User, Calendar, Layers, Hammer, ShieldAlert, CheckSquare, Sparkles,
  ExternalLink, FileText, PackageCheck, Briefcase, Boxes
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

  // Unpack merged deliverables or requirements into individual fields when opening an existing record
  const loadExtra = (full) => {
    const patch = {};
    if (full.deliverables) {
      const parts = full.deliverables.split('|').map((s) => s.trim());
      const remaining = [];
      let unpackedAny = false;
      for (const p of parts) {
        const [k, ...rest] = p.split(':');
        const key = k?.trim()?.toLowerCase();
        const val = rest.join(':').trim();
        if ((key === 'sizes' || key === 'size') && (!full.sizes || full.sizes === '')) {
          patch.sizes = val;
          unpackedAny = true;
        } else if (key === 'thickness' && (!full.thickness || full.thickness === '')) {
          patch.thickness = val;
          unpackedAny = true;
        } else if (key === 'finish' && (!full.finish || full.finish === '')) {
          patch.finish = val;
          unpackedAny = true;
        } else if ((key === 'edges' || key === 'edge') && (!full.edges || full.edges === '')) {
          patch.edges = val;
          unpackedAny = true;
        } else if (key === 'price' && (full.price == null || full.price === '')) {
          const num = Number(val.replace(/[^0-9.]/g, ''));
          if (!isNaN(num) && num > 0) patch.price = num;
          unpackedAny = true;
        } else {
          remaining.push(p);
        }
      }
      if (unpackedAny) {
        patch.deliverables = remaining.join(' | ');
      }
    }
    if (full.requirements) {
      const parts = full.requirements.split('|').map((s) => s.trim());
      const remaining = [];
      let unpackedAny = false;
      for (const p of parts) {
        const [k, ...rest] = p.split(':');
        const key = k?.trim()?.toLowerCase();
        const val = rest.join(':').trim();
        if ((key === 'order no' || key === 'order') && (!full.orderNo || full.orderNo === '')) {
          patch.orderNo = val;
          unpackedAny = true;
        } else if ((key === 'party po' || key === 'party po no' || key === 'po') && (!full.partyPoNo || full.partyPoNo === '')) {
          patch.partyPoNo = val;
          unpackedAny = true;
        } else if ((key === 'sale invoice' || key === 'invoice') && (!full.ourSaleInvoice || full.ourSaleInvoice === '')) {
          patch.ourSaleInvoice = val;
          unpackedAny = true;
        } else {
          remaining.push(p);
        }
      }
      if (unpackedAny) {
        patch.requirements = remaining.join(' | ');
      }
    }
    return patch;
  };

  const fields = [
    // ── General & Order Details ──
    { name: 'name', label: 'Project Name', required: true, wide: true, section: 'General & Order Details', placeholder: 'e.g. Airport Terminal 3 - Sandstone Cladding' },
    { name: 'clientName', label: 'Client / Customer', section: 'General & Order Details', placeholder: 'e.g. L&T Infrastructure, Oberoi Hotels' },
    { name: 'orderNo', label: 'Order No', section: 'General & Order Details', placeholder: 'e.g. SO-101' },
    { name: 'partyPoNo', label: 'Party P.O. No', section: 'General & Order Details', placeholder: 'e.g. PO-882' },
    { name: 'ourSaleInvoice', label: 'Our Sale Invoice', section: 'General & Order Details', placeholder: 'e.g. INV-2026-01' },
    { name: 'site', label: 'Site Location', type: 'select', options: SITE_OPTIONS, default: 'Factory', section: 'General & Order Details' },

    // ── Stone Specifications ──
    { name: 'stoneType', label: 'Stone Variety', type: 'select', options: STONE_VARIETIES, default: 'Teakwood Sandstone', section: 'Stone Specifications' },
    { name: 'sizes', label: 'Sizes', section: 'Stone Specifications', placeholder: 'e.g. Random, 600x600 mm, 600x300 mm' },
    { name: 'thickness', label: 'Thickness', section: 'Stone Specifications', placeholder: 'e.g. 20-25 mm, 30 mm' },
    { name: 'finish', label: 'Finish', section: 'Stone Specifications', placeholder: 'e.g. Tumble, Honed, Polished, Sawn, Flamed' },
    { name: 'edges', label: 'Edges', section: 'Stone Specifications', placeholder: 'e.g. Hand Cut, Machine Cut, Bullnose, Chamfered' },

    // ── Quantities & Commercials ──
    { name: 'price', label: 'Price (₹)', type: 'number', section: 'Quantities & Commercials', placeholder: 'e.g. 65' },
    { name: 'contractValue', label: 'Total Order Amount (₹)', type: 'number', section: 'Quantities & Commercials', placeholder: 'Optional budget / value' },
    { name: 'qtyInSqFt', label: 'Qty In Sq Ft', type: 'number', section: 'Quantities & Commercials', placeholder: 'e.g. 2000' },
    { name: 'qtyInPcs', label: 'Qty In Pcs', type: 'number', section: 'Quantities & Commercials', placeholder: 'e.g. 500' },
    { name: 'qtyInTons', label: 'Qty In Tons', type: 'number', section: 'Quantities & Commercials', placeholder: 'e.g. 15' },
    { name: 'units', label: 'Units', section: 'Quantities & Commercials', placeholder: 'e.g. Sq Ft, Pcs, Tonnes' },
    { name: 'targetQty', label: 'Target Output / Quantity', section: 'Quantities & Commercials', placeholder: 'e.g. 25,000 sq ft / 150 tonnes' },

    // ── Dispatch & Balances ──
    { name: 'dispatchQty', label: 'Dispatch Qty', type: 'number', section: 'Dispatch & Balances', placeholder: 'e.g. 0' },
    { name: 'balanceOrderQty', label: 'Balance Order Qty', type: 'number', section: 'Dispatch & Balances', placeholder: 'e.g. 2000' },
    { name: 'balanceOrderAmount', label: 'Balance Order Amount (₹)', type: 'number', section: 'Dispatch & Balances', placeholder: 'e.g. 130000' },

    // ── Project Planning & Team ──
    {
      name: 'supervisorCode',
      label: 'Supervisor in Charge',
      type: 'ref',
      section: 'Project Planning & Team',
      ref: {
        model: 'employees',
        valueKey: 'empCode',
        nameField: 'supervisorName',
        label: (e) => `${e.name} (${e.empCode})`,
        query: { status: 'active', job: 'Supervisor' },
      },
    },
    { name: 'startDate', label: 'Start Date', type: 'date', default: () => todayISO(), section: 'Project Planning & Team' },
    { name: 'targetDate', label: 'Target Deadline', type: 'date', required: true, section: 'Project Planning & Team' },
    { name: 'status', label: 'Project Status', type: 'select', options: STATUS_OPTIONS, default: 'In Progress', section: 'Project Planning & Team' },
    { name: 'priority', label: 'Priority', type: 'select', options: PRIORITY_OPTIONS, default: 'Normal', section: 'Project Planning & Team' },

    // ── Notes & Instructions ──
    {
      name: 'requirements',
      label: 'What It Needs (Materials & Machines)',
      type: 'textarea',
      wide: true,
      section: 'Notes & Instructions',
      placeholder: 'e.g. 30 Raw Quarry Blocks (Teakwood Grade A), Bridge Cutter 1 & 2 for sizing, Calibration 2 for 20mm thickness, wooden pallets',
    },
    {
      name: 'deliverables',
      label: 'Key Deliverables & Specifications',
      type: 'textarea',
      wide: true,
      section: 'Notes & Instructions',
      placeholder: 'Custom notes or additional deliverables...',
    },
    { name: 'otherRemark', label: 'Other Remark', type: 'textarea', wide: true, section: 'Notes & Instructions', placeholder: 'Extra remarks...' },
    { name: 'notes', label: 'Additional Notes', type: 'textarea', wide: true, section: 'Notes & Instructions' },
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
      render: (r) => {
        const parts = [r.sizes, r.thickness, r.finish, r.edges].filter(Boolean);
        const specSummary = parts.length > 0 ? parts.join(' · ') : r.deliverables;
        return (
          <div className="max-w-[280px] text-xs text-char-700 line-clamp-2" title={specSummary || r.deliverables}>
            {specSummary || '—'}
          </div>
        );
      },
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
          loadExtra={loadExtra}
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
                <KV label="Site / Yard">{selectedProject.site || 'Factory'}</KV>
                <KV label="Supervisor in Charge">
                  <span className="font-semibold text-terra">
                    {selectedProject.supervisorName || selectedProject.supervisorCode || 'Unassigned'}
                  </span>
                </KV>
                <KV label="Start Date">{fmtDate(selectedProject.startDate)}</KV>
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
                {selectedProject.orderNo && <KV label="Order No">{selectedProject.orderNo}</KV>}
                {selectedProject.partyPoNo && <KV label="Party P.O. No">{selectedProject.partyPoNo}</KV>}
                {selectedProject.ourSaleInvoice && <KV label="Our Sale Invoice">{selectedProject.ourSaleInvoice}</KV>}
              </div>

              {/* Stone Specifications & Attributes Grid */}
              <div className="p-3.5 rounded-xl border border-terra-200 bg-terra-50/30 space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-terra-900 flex items-center gap-1.5">
                  <Boxes size={14} className="text-terra" />
                  Stone Specifications & Dimensions
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 text-xs">
                  <div className="bg-white p-2.5 rounded-lg border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block">Stone Variety</span>
                    <span className="font-semibold text-char-800">{selectedProject.stoneType || 'Custom'}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block">Sizes</span>
                    <span className="font-semibold text-char-800">{selectedProject.sizes || '—'}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block">Thickness</span>
                    <span className="font-semibold text-char-800">{selectedProject.thickness || '—'}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block">Finish</span>
                    <span className="font-semibold text-char-800">{selectedProject.finish || '—'}</span>
                  </div>
                  {selectedProject.edges && (
                    <div className="bg-white p-2.5 rounded-lg border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block">Edges</span>
                      <span className="font-semibold text-char-800">{selectedProject.edges}</span>
                    </div>
                  )}
                  {selectedProject.price > 0 && (
                    <div className="bg-white p-2.5 rounded-lg border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block">Price</span>
                      <span className="font-semibold text-char-800">₹{selectedProject.price}</span>
                    </div>
                  )}
                  {(selectedProject.qtyInSqFt > 0 || selectedProject.qtyInPcs > 0 || selectedProject.qtyInTons > 0 || selectedProject.targetQty) && (
                    <div className="bg-white p-2.5 rounded-lg border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block">Quantity</span>
                      <span className="font-semibold text-char-800">
                        {[
                          selectedProject.qtyInSqFt ? `${selectedProject.qtyInSqFt} Sq Ft` : '',
                          selectedProject.qtyInPcs ? `${selectedProject.qtyInPcs} Pcs` : '',
                          selectedProject.qtyInTons ? `${selectedProject.qtyInTons} Tons` : '',
                          selectedProject.targetQty && !selectedProject.qtyInSqFt ? selectedProject.targetQty : ''
                        ].filter(Boolean).join(', ') || '—'}
                      </span>
                    </div>
                  )}
                  {selectedProject.dispatchQty > 0 && (
                    <div className="bg-white p-2.5 rounded-lg border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block">Dispatched Qty</span>
                      <span className="font-semibold text-char-800">{selectedProject.dispatchQty}</span>
                    </div>
                  )}
                  {selectedProject.balanceOrderQty > 0 && (
                    <div className="bg-white p-2.5 rounded-lg border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block">Balance Qty</span>
                      <span className="font-semibold text-char-800">{selectedProject.balanceOrderQty}</span>
                    </div>
                  )}
                </div>
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

              {/* Other Remarks if any */}
              {selectedProject.otherRemark && (
                <div className="p-3 rounded-xl border border-sand-200 bg-sand-50/50 text-xs">
                  <span className="font-bold text-char-700 block mb-1">Other Remark:</span>
                  <span className="text-char-800">{selectedProject.otherRemark}</span>
                </div>
              )}

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
