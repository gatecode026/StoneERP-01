'use client';
import ImportData from '@/components/ImportData';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useState } from 'react';
import toast from '@/lib/toast';
import { api } from '@/lib/client';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, StatCard } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { inr, num, num2, fmtDate, sum } from '@/lib/format';

const STAGES = [{ value: 'received', label: 'In yard' }, { value: 'cutting', label: 'Cutting' }, { value: 'cut', label: 'Cut' }];

export default function BlocksPage() {
  const { t, can, perm } = useApp();
  const [tab, setTab] = useState('blocks');
  const showCost = ['read', 'write'].includes(perm.fields.cost);

  const fields = [
    { name: 'date', label: 'Date received', type: 'date', required: true },
    { name: 'source', label: 'Source', type: 'select', options: [{ value: 'own', label: 'Own quarry' }, { value: 'supplier', label: 'Supplier' }], default: 'own', required: true },
    { name: 'supplierId', label: 'Supplier', type: 'ref', ref: { model: 'suppliers', nameField: 'supplierName' }, show: (f) => f.source === 'supplier' },
    { name: 'truckNo', label: 'Truck number', placeholder: 'RJ06 XX 0000' },
    { name: 'rawanna', label: 'Rawanna number', required: true, hint: 'Each rawanna number can be entered only once' },
    { name: 'rawannaPhoto', label: 'Photo of rawanna', type: 'photo' },
    { name: 'length', label: 'Length (ft)', type: 'number', required: true },
    { name: 'width', label: 'Width (ft)', type: 'number', required: true },
    { name: 'height', label: 'Height (ft)', type: 'number', required: true },
    { name: 'weight', label: 'Weight (tonne, weighbridge slip)', type: 'number' },
    { name: 'grade', label: 'Quality grade', type: 'select', options: ['A', 'B', 'C'], default: 'A' },
    { name: 'photo', label: 'Block photo', type: 'photo' },
    { name: 'yardLocation', label: 'Yard location', placeholder: 'Row 3' },
    ...(showCost ? [{ name: 'costPerCft', label: 'Cost per CFT (₹)', type: 'number', group: 'cost', hint: 'Block cost = CFT × this rate' }] : []),
    { name: 'slabThicknessMm', label: 'Planned slab thickness (mm)', type: 'number', default: 30, hint: 'Used to work out yield %' },
  ];

  const columns = [
    { key: 'blockNo', label: 'Block no.', primary: true, render: (r) => <span className="font-bold">#{r.blockNo}</span> },
    { key: 'date', label: 'Received', render: (r) => fmtDate(r.date) },
    { key: 'source', label: 'Source', render: (r) => (r.source === 'own' ? 'Own quarry' : r.supplierName) },
    { key: 'size', label: 'Size (L×W×H ft)', render: (r) => `${r.length}×${r.width}×${r.height}` },
    { key: 'cft', label: 'CFT', align: 'right', render: (r) => <b>{num2(r.cft)}</b> },
    { key: 'rawanna', label: 'Rawanna' },
    { key: 'grade', label: 'Grade' },
    { key: 'yardLocation', label: 'Yard' },
    { key: 'stage', label: 'Stage', render: (r) => <Badge tone={r.stage === 'cut' ? 'green' : r.stage === 'cutting' ? 'amber' : 'blue'}>{STAGES.find((s) => s.value === r.stage)?.label || r.stage}</Badge> },
  ];

  return (
    <RoleGuard perm="blocks">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'blocks', label: 'Block register' }, { key: 'royalty', label: 'Royalty' }]} />
      {tab === 'blocks' ? (
        <CrudPage model="blocks" headerExtra={<ImportData resource="blocks" perm="blocks" noun="blocks" hint="rawanna and size are required; the block number is given by the app" />} title={t('blocks')} subtitle="Every block gets its own number — follow it until it is cut and sold" label="Block"
          fields={fields} columns={columns} sort="-blockNo"
          canEdit={() => false} addLabel="New block"
          rowActions={(row, { reload }) => (row.stage !== 'cut' && can('blocks', 'edit') ? [{ label: 'Mark cut', onClick: async () => {
            if (!await confirmDialog(`Mark block #${row.blockNo} as fully cut? Its yield % will then be worked out.`)) return;
            try { await api(`/api/blocks/${row._id}/cut`, { method: 'POST', body: {} }); toast.success('Block marked cut – see Yield'); reload(); } catch (e) { toast.error(e.message); } } }] : [])}
          filters={[{ key: 'stage', label: 'All stages', options: STAGES }, { key: 'source', label: 'All sources', options: [{ value: 'own', label: 'Own quarry' }, { value: 'supplier', label: 'Supplier' }] }]}
          facets={{ by: 'stage' }}
          summary={(rows, { facets: f }) => (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Received" value={f?.total ?? '…'} /><StatCard label="In yard" value={f?.groups?.received?.n ?? 0} tone="terra" />
              <StatCard label="Cutting" value={f?.groups?.cutting?.n ?? 0} /><StatCard label="Cut" value={f?.groups?.cut?.n ?? 0} tone="green" />
            </div>
          )}
          exportName="block-register"
          exportColumns={[{ key: 'blockNo', label: 'Block' }, { key: 'date', label: 'Date' }, { key: 'rawanna', label: 'Rawanna' }, { key: 'truckNo', label: 'Truck' }, { key: 'length', label: 'L' }, { key: 'width', label: 'W' }, { key: 'height', label: 'H' }, { key: 'cft', label: 'CFT' }, { key: 'grade', label: 'Grade' }, { key: 'stage', label: 'Stage' }]}
        />
      ) : (
        <CrudPage model="royalties" headerExtra={<ImportData resource="royalties" perm="royalties" noun="royalty records" />} title="Royalty paid record" subtitle="Own quarry — royalty paid and due dates" label="Royalty" sort="-month"
          fields={[
            { name: 'month', label: 'Month', type: 'month', required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', required: true },
            { name: 'dueDate', label: 'Due date', type: 'date', required: true }, { name: 'paidDate', label: 'Paid on', type: 'date' },
            { name: 'state', label: 'Status', type: 'select', options: ['due', 'paid'], default: 'due' }, { name: 'note', label: 'Note', wide: true },
          ]}
          columns={[{ key: 'month', label: 'Month', primary: true }, { key: 'amount', label: 'Amount', render: (r) => inr(r.amount) }, { key: 'dueDate', label: 'Due', render: (r) => fmtDate(r.dueDate) },
            { key: 'paidDate', label: 'Paid on', render: (r) => fmtDate(r.paidDate) }, { key: 'state', label: 'Status', render: (r) => <StatusBadge value={r.state} /> }, { key: 'note', label: 'Note' }]}
        />
      )}
    </RoleGuard>
  );
}
