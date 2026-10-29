'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  FolderKanban, CheckCircle2, Clock, AlertTriangle, Plus, ListChecks,
  User, Users, Calendar, Layers, Hammer, ShieldAlert, CheckSquare, Sparkles,
  ExternalLink, FileText, PackageCheck, Briefcase, Boxes, Pencil, Cog
} from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import ImportData from '@/components/ImportData';
import MultiLookupSelect from '@/components/MultiLookupSelect';
import { RoleGuard, Badge, Sheet, StatCard, KV, cx } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { fmtDate, todayISO, inr, num } from '@/lib/format';
import { api } from '@/lib/client';
import toast from '@/lib/toast';
import T from '@/components/T';

function getProjectTarget(project) {
  if (!project) return { target: 0, unit: 'Pcs', type: 'pcs' };
  if (project.qtyInPcs != null && Number(project.qtyInPcs) > 0) {
    return { target: Number(project.qtyInPcs), unit: project.units || 'Pcs', type: 'pcs' };
  }
  if (project.qtyInSqFt != null && Number(project.qtyInSqFt) > 0) {
    return { target: Number(project.qtyInSqFt), unit: project.units || 'Sq Ft', type: 'sqft' };
  }
  if (project.targetQty) {
    const raw = String(project.targetQty);
    const numMatch = raw.match(/([0-9,.]+)\s*(pcs|pieces|pc|sq\s*ft|sqft|tons|ton|cft)?/i);
    if (numMatch) {
      const val = parseFloat(numMatch[1].replace(/,/g, ''));
      const u = numMatch[2] ? (numMatch[2].toLowerCase().includes('sq') ? 'Sq Ft' : numMatch[2].toLowerCase().includes('ton') ? 'Tons' : 'Pcs') : (project.units || 'Pcs');
      return { target: val, unit: u, type: u.toLowerCase().includes('sq') ? 'sqft' : 'pcs' };
    }
  }
  return { target: 0, unit: project.units || 'Pcs', type: 'pcs' };
}

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
  const isOwner = Boolean(session?.isOwner || session?.perm?.isOwner || session?.role === 'owner');
  const sp = useSearchParams();
  const today = todayISO();

  // Selected project for viewing details and tasks
  const [selectedProject, setSelectedProject] = useState(null);

  // Authoritative loader for project details: immediately displays cached row and fetches fresh document from server
  const openProjectDetails = async (proj) => {
    if (!proj) return;
    setSelectedProject(proj);
    if (!proj._id) return;
    try {
      const full = await api(`/api/projects/${proj._id}?_t=${Date.now()}`);
      if (full && full._id) {
        setSelectedProject((prev) => (prev?._id === full._id ? { ...prev, ...full } : prev));
      }
    } catch {
      // keep initial row if detail fetch fails
    }
  };

  // Keep selectedProject in sync whenever data changes
  useEffect(() => {
    if (!selectedProject?._id) return;
    const handleDataChanged = async () => {
      try {
        const fresh = await api(`/api/projects/${selectedProject._id}?_t=${Date.now()}`);
        if (fresh && fresh._id) {
          setSelectedProject((prev) => (prev?._id === fresh._id ? { ...prev, ...fresh } : prev));
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('vss-data-changed', handleDataChanged);
    return () => window.removeEventListener('vss-data-changed', handleDataChanged);
  }, [selectedProject?._id]);

  // Work progress update modal state
  const [progressModalProject, setProgressModalProject] = useState(null);
  const [progressInputType, setProgressInputType] = useState('total'); // 'total' | 'add'
  const [progressValue, setProgressValue] = useState('');
  const [progressNotes, setProgressNotes] = useState('');
  const [markAsCompleted, setMarkAsCompleted] = useState(false);
  const [progressBusy, setProgressBusy] = useState(false);

  const openProgressModal = (project) => {
    setProgressModalProject(project);
    const currentCompleted = Number(project.completedPcs || 0);
    setProgressValue(String(currentCompleted));
    setProgressInputType('total');
    setProgressNotes('');
    setMarkAsCompleted(project.status === 'Completed');
  };

  async function handleSaveProgress(e) {
    e?.preventDefault?.();
    if (!progressModalProject) return;
    const { target, unit } = getProjectTarget(progressModalProject);
    let newCompleted = 0;
    const inputNum = Number(progressValue || 0);
    if (progressInputType === 'add') {
      newCompleted = Number(progressModalProject.completedPcs || 0) + inputNum;
    } else {
      newCompleted = inputNum;
    }
    if (isNaN(newCompleted) || newCompleted < 0) {
      toast.error('Please enter a valid positive number');
      return;
    }
    const newLeft = target > 0 ? Math.max(0, target - newCompleted) : 0;
    const shouldComplete = markAsCompleted || (target > 0 && newLeft === 0);

    setProgressBusy(true);
    try {
      await api(`/api/projects/${progressModalProject._id}`, {
        method: 'PATCH',
        body: {
          completedPcs: newCompleted,
          balancePcs: newLeft,
          ...(shouldComplete ? { status: 'Completed' } : {}),
          ...(progressNotes.trim() ? { notes: [progressModalProject.notes, `[${todayISO()}] Progress update: ${num(newCompleted)} ${unit} completed (${progressNotes.trim()})`].filter(Boolean).join('\n') } : {}),
        },
      });
      toast.success(`Progress updated! ${num(newCompleted)} / ${num(target)} ${unit} (${num(newLeft)} left)`);
      setProgressModalProject(null);
      if (selectedProject?._id === progressModalProject._id) {
        setSelectedProject((prev) => ({
          ...prev,
          completedPcs: newCompleted,
          balancePcs: newLeft,
          ...(shouldComplete ? { status: 'Completed' } : {}),
        }));
      }
      window.dispatchEvent(new CustomEvent('vss-data-changed'));
      statsFetch.reload();
    } catch (err) {
      toast.error(err.message);
    }
    setProgressBusy(false);
  }

  // Modal state for assigning multiple supervisors & operators to a project
  const [assignModalProject, setAssignModalProject] = useState(null);
  const [assignSelectedSupervisorCodes, setAssignSelectedSupervisorCodes] = useState([]);
  const [assignSelectedSupervisorNames, setAssignSelectedSupervisorNames] = useState('');
  const [assignSelectedOperatorCodes, setAssignSelectedOperatorCodes] = useState([]);
  const [assignSelectedOperatorNames, setAssignSelectedOperatorNames] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);

  const openAssignModal = (project) => {
    setAssignModalProject(project);
    const sCodes = project.supervisorCodes?.length
      ? project.supervisorCodes
      : (project.supervisorCode ? String(project.supervisorCode).split(',').map((s) => s.trim()).filter(Boolean) : []);
    setAssignSelectedSupervisorCodes(sCodes);
    setAssignSelectedSupervisorNames(project.supervisorName || '');

    const opCodes = project.operatorCodes?.length
      ? project.operatorCodes
      : (project.operatorCode ? String(project.operatorCode).split(',').map((s) => s.trim()).filter(Boolean) : []);
    setAssignSelectedOperatorCodes(opCodes);
    setAssignSelectedOperatorNames(project.operatorName || '');
  };

  async function handleSaveTeam(e) {
    e?.preventDefault?.();
    if (!assignModalProject) return;
    setAssignBusy(true);
    try {
      const res = await api(`/api/projects/${assignModalProject._id}`, {
        method: 'PATCH',
        body: {
          supervisorCodes: assignSelectedSupervisorCodes,
          supervisorCode: assignSelectedSupervisorCodes.join(','),
          operatorCodes: assignSelectedOperatorCodes,
          operatorCode: assignSelectedOperatorCodes.join(','),
        },
      });
      toast.success(`Team assigned for ${assignModalProject.name}`);
      setAssignModalProject(null);
      if (selectedProject?._id === assignModalProject._id) {
        setSelectedProject((prev) => ({
          ...prev,
          ...(res || {}),
          supervisorCodes: assignSelectedSupervisorCodes,
          supervisorCode: assignSelectedSupervisorCodes.join(','),
          supervisorName: res?.supervisorName || assignSelectedSupervisorNames,
          operatorCodes: assignSelectedOperatorCodes,
          operatorCode: assignSelectedOperatorCodes.join(','),
          operatorName: res?.operatorName || assignSelectedOperatorNames,
        }));
      }
      window.dispatchEvent(new CustomEvent('vss-data-changed'));
      statsFetch.reload();
    } catch (err) {
      toast.error(err.message);
    }
    setAssignBusy(false);
  }

  // Stats
  const statsFetch = useFetch('/api/projects?limit=200');
  const allProjects = statsFetch.data?.rows || statsFetch.data || [];
  const inProgressCount = allProjects.filter((p) => p.status === 'In Progress').length;
  const highPriorityCount = allProjects.filter((p) => p.priority === 'High' || p.priority === 'Urgent').length;
  const completedCount = allProjects.filter((p) => p.status === 'Completed').length;
  const pendingCount = allProjects.filter((p) => p.status === 'Pending' || p.status === 'Planning' || p.status === 'On Hold').length;

  const canManage = can('projects', 'create') || can('projects', 'edit') || session?.role === 'owner' || session?.role === 'manager';

  // Unpack merged deliverables or requirements into individual fields when opening an existing record
  const loadExtra = (full) => {
    const patch = {};
    if (full.supervisorCodes && full.supervisorCodes.length && (!full.supervisorCode || !full.supervisorCode.includes(','))) {
      patch.supervisorCode = full.supervisorCodes.join(',');
    }
    if (full.operatorCodes && full.operatorCodes.length && (!full.operatorCode || !full.operatorCode.includes(','))) {
      patch.operatorCode = full.operatorCodes.join(',');
    }
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
    ...(isOwner ? [{ name: 'clientName', label: 'Client / Customer', section: 'General & Order Details', placeholder: 'e.g. L&T Infrastructure, Oberoi Hotels' }] : []),
    { name: 'orderNo', label: 'Order No', section: 'General & Order Details', placeholder: 'e.g. SO-101' },
    { name: 'partyPoNo', label: 'Party P.O. No', section: 'General & Order Details', placeholder: 'e.g. PO-882' },
    { name: 'ourSaleInvoice', label: 'Our Sale Invoice', section: 'General & Order Details', placeholder: 'e.g. INV-2026-01' },
    { name: 'site', label: 'Site Location', type: 'select', options: SITE_OPTIONS, default: 'Factory', section: 'General & Order Details' },

    // ── Stone Specifications ──
    { name: 'stoneType', label: 'Colour Name', section: 'Stone Specifications', placeholder: 'e.g. Teakwood Sandstone, Kotah Blue, Dholpur Pink' },
    { name: 'sizes', label: 'Sizes', section: 'Stone Specifications', placeholder: 'e.g. Random, 600x600 mm, 600x300 mm' },
    { name: 'thickness', label: 'Thickness', section: 'Stone Specifications', placeholder: 'e.g. 20-25 mm, 30 mm' },
    { name: 'finish', label: 'Finish', section: 'Stone Specifications', placeholder: 'e.g. Tumble, Honed, Polished, Sawn, Flamed' },
    { name: 'edges', label: 'Edges', section: 'Stone Specifications', placeholder: 'e.g. Hand Cut, Machine Cut, Bullnose, Chamfered' },

    // ── Quantities & Commercials ──
    ...(isOwner ? [
      { name: 'price', label: 'Price (₹)', type: 'number', section: 'Quantities & Commercials', placeholder: 'e.g. 65' },
      { name: 'contractValue', label: 'Total Order Amount (₹)', type: 'number', section: 'Quantities & Commercials', placeholder: 'Optional budget / value' },
    ] : []),
    { name: 'qtyInPcs', label: 'Qty In Pcs', type: 'number', section: 'Quantities & Commercials', placeholder: 'e.g. 2100' },
    { name: 'completedPcs', label: 'Completed Pcs', type: 'number', section: 'Quantities & Commercials', placeholder: 'e.g. 1200' },
    { name: 'balancePcs', label: 'Balance / Left Pcs', type: 'number', section: 'Quantities & Commercials', placeholder: 'e.g. 900', hint: 'Auto-calculated: Target - Completed' },
    { name: 'qtyInSqFt', label: 'Qty In Sq Ft', type: 'number', section: 'Quantities & Commercials', placeholder: 'e.g. 2000' },
    { name: 'qtyInTons', label: 'Qty In Tons', type: 'number', section: 'Quantities & Commercials', placeholder: 'e.g. 15' },
    { name: 'units', label: 'Units', section: 'Quantities & Commercials', placeholder: 'e.g. Sq Ft, Pcs, Tonnes' },
    { name: 'targetQty', label: 'Target Output / Quantity', section: 'Quantities & Commercials', placeholder: 'e.g. 25,000 sq ft / 150 tonnes' },

    // ── Dispatch & Balances ──
    { name: 'dispatchQty', label: 'Dispatch Qty', type: 'number', section: 'Dispatch & Balances', placeholder: 'e.g. 0' },
    { name: 'balanceOrderQty', label: 'Balance Order Qty', type: 'number', section: 'Dispatch & Balances', placeholder: 'e.g. 2000' },
    ...(isOwner ? [
      { name: 'balanceOrderAmount', label: 'Balance Order Amount (₹)', type: 'number', section: 'Dispatch & Balances', placeholder: 'e.g. 130000' },
    ] : []),

    // ── Project Planning & Team ──
    {
      name: 'supervisorCode',
      label: 'Supervisors in Charge',
      type: 'ref',
      multiple: true,
      section: 'Project Planning & Team',
      placeholder: 'Select one or more supervisors…',
      emptyText: 'No supervisors found',
      ref: {
        model: 'employees',
        valueKey: 'empCode',
        nameField: 'supervisorName',
        label: (e) => `${e.name} (${e.empCode})`,
        query: { status: 'active', job: 'Supervisor' },
      },
    },
    {
      name: 'operatorCode',
      label: 'Operators in Charge',
      type: 'ref',
      multiple: true,
      section: 'Project Planning & Team',
      placeholder: 'Select one or more operators…',
      emptyText: 'No operators found',
      ref: {
        model: 'employees',
        valueKey: 'empCode',
        nameField: 'operatorName',
        label: (e) => `${e.name} (${e.empCode})`,
        query: { status: 'active', job: 'Operator' },
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
          {isOwner && r.clientName && (
            <span className="text-xs text-char-500 font-normal">
              Client: <b className="text-char-700">{r.clientName}</b>
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'stoneType',
      label: 'Stone',
      render: (r) => (
        <div className="text-xs font-semibold text-char-800">{r.stoneType || 'Stone Supply'}</div>
      ),
    },
    {
      key: 'workProgress',
      label: 'Current Status',
      render: (r) => {
        const { target, unit } = getProjectTarget(r);
        const completed = Number(r.completedPcs || 0);
        const left = target > 0 ? Math.max(0, target - completed) : (r.balancePcs != null ? Number(r.balancePcs) : 0);
        const pct = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;

        return (
          <div className="text-xs py-0.5">
            <div className="flex items-center gap-1.5 flex-wrap font-medium">
              <span>
                <b className="text-char-900">{num(completed)}</b>
                <span className="text-char-500"> / {target > 0 ? num(target) : '—'} {unit}</span>
              </span>
              {target > 0 && (
                <span className="text-amber-700 font-semibold text-[11px] bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                  {num(left)} left
                </span>
              )}
            </div>
          </div>
        );
      },
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
      key: 'team',
      label: 'Team',
      render: (r) => (
        <div className="flex flex-col gap-1 text-xs max-w-[210px]">
          <div className="flex items-center gap-1.5" title={r.supervisorName || r.supervisorCode || undefined}>
            <User size={13} className="text-terra shrink-0" />
            <span className="font-medium text-char-800 line-clamp-1">
              {r.supervisorName || r.supervisorCode || <span className="text-char-400 font-normal">Unassigned</span>}
            </span>
          </div>
          {(r.operatorName || r.operatorCode) ? (
            <div className="flex items-center gap-1.5 text-char-600" title={r.operatorName || r.operatorCode || undefined}>
              <Cog size={13} className="text-char-500 shrink-0" />
              <span className="text-[11px] line-clamp-1">
                {r.operatorName || r.operatorCode}
              </span>
            </div>
          ) : null}
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
  ];

  return (
    <RoleGuard perm="projects">
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
          subtitle="Track stone projects, material requirements, deliverables, and assigned supervisors"
          label="Project"
          addLabel="New Project"
          headerExtra={
            isOwner ? (
              <ImportData
                resource="projects"
                perm="projects"
                noun="projects"
                hint="order date, order no, party name, colour, finish, sizes, quantities and total amount"
              />
            ) : null
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
          onRowClick={(row) => openProjectDetails(row)}
          rowActions={(row) => [
            {
              label: 'View Project Details',
              icon: <FolderKanban size={14} className="text-terra" />,
              onClick: () => openProjectDetails(row),
            },
            {
              label: 'Assign Team (Supervisors / Operators)',
              icon: <User size={14} className="text-terra" />,
              onClick: () => openAssignModal(row),
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
              <div>
                <button
                  type="button"
                  className="btn-outline !text-xs !py-1.5 !px-4 font-medium"
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
              {/* Current Status / Pieces Progress Card */}
              {(() => {
                const { target, unit } = getProjectTarget(selectedProject);
                const completed = Number(selectedProject.completedPcs || 0);
                const left = target > 0 ? Math.max(0, target - completed) : (selectedProject.balancePcs != null ? Number(selectedProject.balancePcs) : 0);
                const pct = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;

                return (
                  <div className="p-3.5 rounded-none border border-terra-200 bg-gradient-to-br from-terra-50/50 to-sand-50/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Boxes size={16} className="text-terra" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-char-900">
                          Current Status / Pieces & Work Progress
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => openProgressModal(selectedProject)}
                        className="btn-primary !text-xs !py-1 !px-3 flex items-center gap-1.5 font-bold shadow-xs"
                      >
                        <Pencil size={12} /> Update Completed Pieces
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded-none bg-white border border-sand-200 shadow-xs">
                        <span className="text-[10px] font-bold uppercase text-char-500 block">Needs / Target</span>
                        <span className="text-sm font-black text-char-900">{target > 0 ? `${num(target)} ${unit}` : (selectedProject.targetQty || '—')}</span>
                      </div>
                      <div className="p-2 rounded-none bg-emerald-50 border border-emerald-200 shadow-xs">
                        <span className="text-[10px] font-bold uppercase text-emerald-700 block">Completed</span>
                        <span className="text-sm font-black text-emerald-800">{num(completed)} {unit}</span>
                      </div>
                      <div className="p-2 rounded-none bg-amber-50 border border-amber-200 shadow-xs">
                        <span className="text-[10px] font-bold uppercase text-amber-700 block">Left / Remaining</span>
                        <span className="text-sm font-black text-amber-800">{target > 0 ? `${num(left)} ${unit}` : '—'}</span>
                      </div>
                    </div>

                    {target > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs font-semibold text-char-700">
                          <span className={pct === 100 ? 'text-emerald-700 font-bold' : 'text-char-700'}>{pct}% Completed</span>
                          <span className="text-char-500">{num(completed)} of {num(target)} {unit} ({num(left)} left to finish)</span>
                        </div>
                        <div className="w-full bg-sand-200 h-2.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${pct === 100 ? 'bg-emerald-500' : 'bg-terra'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Order Details & Schedule Information */}
              <div className="p-3.5 rounded-none border border-sand-300 bg-sand-50/50 space-y-2.5">
                <div className="flex items-center gap-1.5">
                  <FolderKanban size={15} className="text-terra" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-char-900">
                    Order Details & Project Schedule
                  </h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 text-xs">
                  {isOwner && (
                    <div className="bg-white p-2.5 rounded-none border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block mb-0.5">Client / Customer</span>
                      <span className="font-semibold text-char-900 truncate block" title={selectedProject.clientName || 'Direct Order'}>
                        {selectedProject.clientName || 'Direct Order'}
                      </span>
                    </div>
                  )}
                  <div className="bg-white p-2.5 rounded-none border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block mb-0.5">Site / Yard</span>
                    <span className="font-semibold text-char-800">{selectedProject.site || 'Factory'}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-none border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block mb-0.5">Status</span>
                    <Badge tone={selectedProject.status === 'Completed' ? 'green' : selectedProject.status === 'In Progress' ? 'amber' : 'gray'}>
                      {selectedProject.status || 'Planning'}
                    </Badge>
                  </div>
                  <div className="bg-white p-2.5 rounded-none border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block mb-0.5">Priority</span>
                    <Badge tone={selectedProject.priority === 'Urgent' ? 'red' : selectedProject.priority === 'High' ? 'amber' : 'gray'}>
                      {selectedProject.priority || 'Normal'}
                    </Badge>
                  </div>
                  <div className="bg-white p-2.5 rounded-none border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block mb-0.5">Start Date</span>
                    <span className="font-semibold text-char-800">{fmtDate(selectedProject.startDate)}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-none border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block mb-0.5">Target Deadline</span>
                    <span className={`font-semibold ${selectedProject.targetDate < today && selectedProject.status !== 'Completed' ? 'text-red-600 font-bold' : 'text-char-800'}`}>
                      {fmtDate(selectedProject.targetDate)}
                    </span>
                  </div>
                  {isOwner && selectedProject.contractValue > 0 && (
                    <div className="bg-white p-2.5 rounded-none border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block mb-0.5">Contract Value</span>
                      <span className="font-semibold text-char-900">{inr(selectedProject.contractValue)}</span>
                    </div>
                  )}
                  {selectedProject.orderNo && (
                    <div className="bg-white p-2.5 rounded-none border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block mb-0.5">Order No</span>
                      <span className="font-semibold text-char-800">{selectedProject.orderNo}</span>
                    </div>
                  )}
                  {selectedProject.partyPoNo && (
                    <div className="bg-white p-2.5 rounded-none border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block mb-0.5">Party P.O. No</span>
                      <span className="font-semibold text-char-800">{selectedProject.partyPoNo}</span>
                    </div>
                  )}
                  {selectedProject.ourSaleInvoice && (
                    <div className="bg-white p-2.5 rounded-none border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block mb-0.5">Our Sale Invoice</span>
                      <span className="font-semibold text-char-800">{selectedProject.ourSaleInvoice}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Dedicated Project Team: Supervisors & Operators in Charge */}
              {(() => {
                const supervisorList = selectedProject.supervisorName
                  ? selectedProject.supervisorName.split(',').map((s) => s.trim()).filter(Boolean)
                  : (selectedProject.supervisorCode ? [selectedProject.supervisorCode] : []);

                const operatorList = selectedProject.operatorName
                  ? selectedProject.operatorName.split(',').map((s) => s.trim()).filter(Boolean)
                  : (selectedProject.operatorCode ? [selectedProject.operatorCode] : []);

                return (
                  <div className="p-3.5 rounded-none border border-sand-300 bg-sand-50/70 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-sand-200">
                      <div className="flex items-center gap-1.5">
                        <Users size={15} className="text-terra" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-char-900">
                          Project Team & Personnel in Charge
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => openAssignModal(selectedProject)}
                        className="btn-outline !text-xs !py-1 !px-2.5 flex items-center gap-1.5 font-bold text-terra border-terra-300 hover:bg-terra-50"
                      >
                        <User size={12} /> Assign / Change Team
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {/* Supervisors in Charge */}
                      <div className="bg-white p-3 rounded-none border border-sand-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-char-700 flex items-center gap-1.5">
                            <User size={13} className="text-terra" />
                            Supervisors in Charge
                          </span>
                          {supervisorList.length > 0 && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sand-100 text-char-700 border border-sand-200">
                              {supervisorList.length} {supervisorList.length === 1 ? 'Supervisor' : 'Supervisors'}
                            </span>
                          )}
                        </div>
                        {supervisorList.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {supervisorList.map((name, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-terra-50 text-terra-900 border border-terra-200 text-xs font-semibold rounded-none shadow-2xs"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-terra shrink-0" />
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-char-400 italic">No supervisors assigned</span>
                        )}
                      </div>

                      {/* Operators in Charge */}
                      <div className="bg-white p-3 rounded-none border border-sand-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-char-700 flex items-center gap-1.5">
                            <Cog size={13} className="text-terra" />
                            Operators in Charge
                          </span>
                          {operatorList.length > 0 && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sand-100 text-char-700 border border-sand-200">
                              {operatorList.length} {operatorList.length === 1 ? 'Operator' : 'Operators'}
                            </span>
                          )}
                        </div>
                        {operatorList.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {operatorList.map((name, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-sand-100 text-char-900 border border-sand-300 text-xs font-semibold rounded-none shadow-2xs"
                              >
                                <Cog size={12} className="text-char-500 shrink-0" />
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-char-400 italic">No operators assigned</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Stone Specifications & Attributes Grid */}
              <div className="p-3.5 rounded-none border border-terra-200 bg-terra-50/30 space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-terra-900 flex items-center gap-1.5">
                  <Boxes size={14} className="text-terra" />
                  Stone Specifications & Dimensions
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 text-xs">
                  <div className="bg-white p-2.5 rounded-none border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block">Colour Name</span>
                    <span className="font-semibold text-char-800">{selectedProject.stoneType || 'Custom'}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-none border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block">Sizes</span>
                    <span className="font-semibold text-char-800">{selectedProject.sizes || '—'}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-none border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block">Thickness</span>
                    <span className="font-semibold text-char-800">{selectedProject.thickness || '—'}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-none border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block">Finish</span>
                    <span className="font-semibold text-char-800">{selectedProject.finish || '—'}</span>
                  </div>
                  {selectedProject.edges && (
                    <div className="bg-white p-2.5 rounded-none border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block">Edges</span>
                      <span className="font-semibold text-char-800">{selectedProject.edges}</span>
                    </div>
                  )}
                  {isOwner && selectedProject.price > 0 && (
                    <div className="bg-white p-2.5 rounded-none border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block">Price</span>
                      <span className="font-semibold text-char-800">₹{selectedProject.price}</span>
                    </div>
                  )}
                  {(selectedProject.qtyInSqFt > 0 || selectedProject.qtyInPcs > 0 || selectedProject.qtyInTons > 0 || selectedProject.targetQty) && (
                    <div className="bg-white p-2.5 rounded-none border border-sand-200">
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
                    <div className="bg-white p-2.5 rounded-none border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block">Dispatched Qty</span>
                      <span className="font-semibold text-char-800">{selectedProject.dispatchQty}</span>
                    </div>
                  )}
                  {selectedProject.balanceOrderQty > 0 && (
                    <div className="bg-white p-2.5 rounded-none border border-sand-200">
                      <span className="text-[10px] uppercase font-bold text-char-500 block">Balance Qty</span>
                      <span className="font-semibold text-char-800">{selectedProject.balanceOrderQty}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* What It Needs & Deliverables Split */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* Requirements / Needs */}
                <div className="p-3.5 rounded-none border border-amber-200 bg-amber-50/40">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5 mb-2">
                    <Layers size={14} className="text-amber-700" />
                    What It Needs (Raw Materials, Blocks & Machines)
                  </h3>
                  <div className="text-xs text-char-800 whitespace-pre-wrap leading-relaxed">
                    {selectedProject.requirements || 'No specific raw material or machine requirements recorded.'}
                  </div>
                </div>

                {/* Deliverables */}
                <div className="p-3.5 rounded-none border border-emerald-200 bg-emerald-50/40">
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
                <div className="p-3 rounded-none border border-sand-200 bg-sand-50/50 text-xs">
                  <span className="font-bold text-char-700 block mb-1">Other Remark:</span>
                  <span className="text-char-800">{selectedProject.otherRemark}</span>
                </div>
              )}

            </div>
          )}
        </Sheet>

        {/* Assign Team (Supervisors & Operators) Modal */}
        <Sheet
          open={Boolean(assignModalProject)}
          onClose={() => setAssignModalProject(null)}
          title={tr('Assign Team – {name}', { name: assignModalProject?.name || 'Project' })}
          className="md:!min-h-[580px] md:!max-w-2xl"
          bodyClassName="!min-h-[460px] overflow-visible pb-28 space-y-5"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <button
                type="button"
                className="btn-outline !text-xs !py-1.5 !px-3"
                onClick={() => setAssignModalProject(null)}
                disabled={assignBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary !text-xs !py-1.5 !px-4 flex items-center gap-1.5 font-bold"
                onClick={handleSaveTeam}
                disabled={assignBusy}
              >
                {assignBusy ? 'Saving…' : 'Save Team'}
              </button>
            </div>
          }
        >
          {assignModalProject && (
            <div className="space-y-5">
              <div className="p-3 rounded-none bg-sand-50 border border-sand-200 text-xs">
                <div className="font-bold text-char-900 text-sm">{assignModalProject.name}</div>
                <div className="text-char-500 mt-0.5">
                  Code: <b className="text-char-700">{assignModalProject.projectCode}</b>
                  {isOwner && assignModalProject.clientName ? (
                    <> · Client: <b className="text-char-700">{assignModalProject.clientName}</b></>
                  ) : null}
                </div>
              </div>

              <div>
                <label className="label">Select Supervisors (Checkbox Multi-Select)</label>
                <MultiLookupSelect
                  kind="employees"
                  by="empCode"
                  query={{ status: 'active', job: 'Supervisor' }}
                  value={assignSelectedSupervisorCodes}
                  valueLabel={assignSelectedSupervisorNames}
                  placeholder="Select one or more supervisors…"
                  emptyText="No supervisors found"
                  onChange={(selected) => {
                    setAssignSelectedSupervisorCodes(selected.map((s) => s.id));
                    setAssignSelectedSupervisorNames(selected.map((s) => s.label).join(', '));
                  }}
                />
                <p className="text-[11px] text-char-500 mt-1.5">
                  Supervisors will oversee site operations, review checklists, and manage work schedules.
                </p>
              </div>

              <div>
                <label className="label">Select Operators (Checkbox Multi-Select)</label>
                <MultiLookupSelect
                  kind="employees"
                  by="empCode"
                  query={{ status: 'active', job: 'Operator' }}
                  value={assignSelectedOperatorCodes}
                  valueLabel={assignSelectedOperatorNames}
                  placeholder="Select one or more operators…"
                  emptyText="No operators found"
                  onChange={(selected) => {
                    setAssignSelectedOperatorCodes(selected.map((s) => s.id));
                    setAssignSelectedOperatorNames(selected.map((s) => s.label).join(', '));
                  }}
                />
                <p className="text-[11px] text-char-500 mt-1.5">
                  Operators assigned to run machines, cutting, sizing, and calibration for this project.
                </p>
              </div>
            </div>
          )}
        </Sheet>

        {/* Work Progress Update Sheet */}
        <Sheet
          open={Boolean(progressModalProject)}
          onClose={() => setProgressModalProject(null)}
          title="Update Work Progress & Completed Pieces"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <button
                type="button"
                className="btn-outline !text-xs !py-1.5 !px-3"
                onClick={() => setProgressModalProject(null)}
                disabled={progressBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary !text-xs !py-1.5 !px-4 flex items-center gap-1.5 font-bold"
                onClick={handleSaveProgress}
                disabled={progressBusy}
              >
                {progressBusy ? 'Saving…' : 'Save Progress'}
              </button>
            </div>
          }
        >
          {progressModalProject && (() => {
            const { target, unit } = getProjectTarget(progressModalProject);
            const currentDone = Number(progressModalProject.completedPcs || 0);
            const inputVal = Number(progressValue || 0);
            const calcCompleted = progressInputType === 'add' ? currentDone + inputVal : inputVal;
            const calcLeft = target > 0 ? Math.max(0, target - calcCompleted) : 0;
            const calcPct = target > 0 ? Math.min(100, Math.round((calcCompleted / target) * 100)) : 0;

            return (
              <form onSubmit={handleSaveProgress} className="space-y-4">
                <div className="p-3 rounded-none bg-sand-50 border border-sand-200 text-xs">
                  <div className="font-bold text-char-900 text-sm">{progressModalProject.name}</div>
                  <div className="text-char-500 mt-0.5">Code: <b className="text-char-700">{progressModalProject.projectCode}</b> · Colour: <b className="text-char-700">{progressModalProject.stoneType || 'Custom'}</b></div>
                </div>

                {/* Target & Live Calculation Overview */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2.5 rounded-none bg-white border border-sand-200">
                    <span className="text-[10px] uppercase font-bold text-char-500 block">Needs / Target</span>
                    <span className="text-sm font-black text-char-900">{target > 0 ? `${num(target)} ${unit}` : (progressModalProject.targetQty || '—')}</span>
                  </div>
                  <div className="p-2.5 rounded-none bg-emerald-50 border border-emerald-200">
                    <span className="text-[10px] uppercase font-bold text-emerald-700 block">Completed</span>
                    <span className="text-sm font-black text-emerald-800">{num(calcCompleted)} {unit}</span>
                  </div>
                  <div className="p-2.5 rounded-none bg-amber-50 border border-amber-200">
                    <span className="text-[10px] uppercase font-bold text-amber-700 block">Left / Remaining</span>
                    <span className="text-sm font-black text-amber-800">{target > 0 ? `${num(calcLeft)} ${unit}` : '—'}</span>
                  </div>
                </div>

                {/* Progress bar preview */}
                {target > 0 && (
                  <div className="p-3 rounded-none bg-sand-50/70 border border-sand-200 space-y-1.5">
                    <div className="flex justify-between items-center text-xs font-semibold text-char-700">
                      <span>{calcPct}% Completed</span>
                      <span className="text-char-500">{num(calcCompleted)} of {num(target)} {unit} ({num(calcLeft)} left)</span>
                    </div>
                    <div className="w-full bg-sand-200 h-2.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${calcPct === 100 ? 'bg-emerald-500' : 'bg-terra'}`}
                        style={{ width: `${calcPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Entry mode toggle */}
                <div className="space-y-1">
                  <label className="label">Update Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setProgressInputType('total');
                        setProgressValue(String(currentDone));
                      }}
                      className={cx(
                        'py-2 px-3 rounded-none border text-xs font-bold transition flex items-center justify-center gap-1.5',
                        progressInputType === 'total'
                          ? 'bg-terra text-white border-terra shadow-xs'
                          : 'bg-white text-char-700 border-sand-200 hover:bg-sand-50'
                      )}
                    >
                      Set Total Completed
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProgressInputType('add');
                        setProgressValue('');
                      }}
                      className={cx(
                        'py-2 px-3 rounded-none border text-xs font-bold transition flex items-center justify-center gap-1.5',
                        progressInputType === 'add'
                          ? 'bg-terra text-white border-terra shadow-xs'
                          : 'bg-white text-char-700 border-sand-200 hover:bg-sand-50'
                      )}
                    >
                      + Add Pieces Done Today
                    </button>
                  </div>
                </div>

                {/* Input for completed pieces */}
                <div>
                  <label className="label">
                    {progressInputType === 'add' ? `Pieces Completed Today (${unit}) *` : `Total Pieces Completed So Far (${unit}) *`}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="input !text-lg !font-bold"
                    placeholder={progressInputType === 'add' ? 'e.g. 200' : 'e.g. 1200'}
                    value={progressValue}
                    onChange={(e) => setProgressValue(e.target.value)}
                    required
                    autoFocus
                  />
                  <div className="text-[11px] text-char-500 mt-1">
                    {progressInputType === 'add'
                      ? `Adding to previous ${num(currentDone)} ${unit} = total ${num(calcCompleted)} ${unit}`
                      : `Currently recorded: ${num(currentDone)} ${unit}`}
                  </div>
                </div>

                {/* Mark as completed checkbox */}
                <div className="pt-2 border-t border-sand-200">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-char-800">
                    <input
                      type="checkbox"
                      checked={markAsCompleted || (target > 0 && calcLeft === 0)}
                      onChange={(e) => setMarkAsCompleted(e.target.checked)}
                      className="rounded border-sand-300 text-terra focus:ring-terra"
                    />
                    <span>Mark project status as <b>Completed</b> {target > 0 && calcLeft === 0 ? '(Target 100% achieved!)' : ''}</span>
                  </label>
                </div>

                {/* Work note */}
                <div>
                  <label className="label">Work Narration / Notes (Optional)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Cut 300 pcs on Bridge Cutter 1; edge finish completed"
                    value={progressNotes}
                    onChange={(e) => setProgressNotes(e.target.value)}
                  />
                </div>
              </form>
            );
          })()}
        </Sheet>
      </div>
    </RoleGuard>
  );
}
