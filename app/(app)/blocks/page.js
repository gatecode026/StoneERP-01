'use client';
import ImportData from '@/components/ImportData';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useState } from 'react';
import toast from '@/lib/toast';
import { api } from '@/lib/client';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, StatCard } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { inr, num, num2, fmtDate, sum, todayISO } from '@/lib/format';

const STAGES = [{ value: 'received', label: 'In yard' }, { value: 'cutting', label: 'Cutting' }, { value: 'cut', label: 'Cut' }];

export default function BlocksPage() {
  const { t, can, perm } = useApp();
  const [tab, setTab] = useState('blocks');
  const showCost = ['read', 'write'].includes(perm.fields.cost);

  const fields = [
    { name: 'date', label: 'Date received', type: 'date', required: true, createOnly: true, validate: (f) => (f.date && f.date > todayISO() ? 'Date received cannot be in the future' : '') },
    { name: 'source', label: 'Source', type: 'select', options: [{ value: 'own', label: 'Own quarry' }, { value: 'supplier', label: 'Supplier' }], default: 'own', required: true, createOnly: true },
    { name: 'supplierId', label: 'Supplier', type: 'ref', ref: { model: 'suppliers', nameField: 'supplierName' }, show: (f) => f.source === 'supplier', required: true, createOnly: true },
    { name: 'truckNo', label: 'Truck number', placeholder: 'RJ06 XX 0000' },
    { name: 'rawanna', label: 'Rawanna number', required: true, createOnly: true, hint: 'Each rawanna number can be entered only once' },
    { name: 'rawannaPhoto', label: 'Photo of rawanna', type: 'photo' },
    { name: 'length', label: 'Length (ft)', type: 'number', required: true, createOnly: true },
    { name: 'width', label: 'Width (ft)', type: 'number', required: true, createOnly: true },
    { name: 'height', label: 'Height (ft)', type: 'number', required: true, createOnly: true },
    { name: 'weight', label: 'Weight (tonne, weighbridge slip)', type: 'number', hint: 'Stone weighs about 0.075 tonne per CFT; a very different weight is questioned' },
    { name: 'grade', label: 'Quality grade', type: 'select', options: ['A', 'B', 'C'], default: 'A' },
    { name: 'photo', label: 'Block photo', type: 'photo' },
    { name: 'yardLocation', label: 'Yard location', placeholder: 'Row 3' },
    ...(showCost ? [{ name: 'costPerCft', label: 'Cost per CFT (₹)', type: 'number', group: 'cost', hint: 'Block cost = CFT × this rate' }] : []),
    { name: 'slabThicknessMm', label: 'Planned slab thickness (mm)', type: 'number', default: 30, hint: 'Used to work out yield %' },
  ];

  const columns = [
    { key: 'blockNo', label: 'Block no.', primary: true, render: (r) => <span className="font-bold">#{r.blockNo}</span> },
    { key: 'date', label: 'Received', render: (r) => fmtDate(r.date) },
    { key: 'source', label: 'Source', render: (r) => (r.source === 'own' ? 'Own quarry' : r.supplierName || 'Supplier') },
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
        <CrudPage key="blocks" model="blocks" headerExtra={<ImportData resource="blocks" perm="blocks" noun="blocks" hint="rawanna and size are required; the block number is given by the app" />} title={t('blocks')} subtitle="Every block gets its own number — follow it until it is cut and sold" label="Block"
          fields={fields} columns={columns} sort="-blockNo"
          addLabel="New block"
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
        <CrudPage key="royalties" model="royalties" headerExtra={<ImportData resource="royalties" perm="royalties" noun="royalty records" />} title="Royalty paid record" subtitle="Own quarry — royalty paid and due dates" label="Royalty" sort="-month"
          fields={[
            { name: 'month', label: 'Month', type: 'month', required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', required: true },
            { name: 'dueDate', label: 'Due date', type: 'date', required: true },
            { name: 'state', label: 'Status', type: 'select', options: ['due', 'paid'], default: 'due' },
            { name: 'paidDate', label: 'Paid on', type: 'date', show: (f) => f.state === 'paid', validate: (f) => (f.state !== 'paid' ? '' : !f.paidDate ? 'Enter the date it was paid' : f.paidDate > todayISO() ? 'Paid on cannot be in the future' : '') },
            { name: 'note', label: 'Note', wide: true },
          ]}
          columns={[{ key: 'month', label: 'Month', primary: true }, { key: 'amount', label: 'Amount', render: (r) => inr(r.amount) }, { key: 'dueDate', label: 'Due', render: (r) => fmtDate(r.dueDate) },
            { key: 'paidDate', label: 'Paid on', render: (r) => fmtDate(r.paidDate) }, { key: 'state', label: 'Status', render: (r) => (r.state === 'due' && r.dueDate < todayISO() ? <Badge tone="red">Overdue</Badge> : <StatusBadge value={r.state} />) }, { key: 'note', label: 'Note' }]}
          rowClass={(r) => (r.state === 'due' && r.dueDate < todayISO() ? 'bg-red-50/60' : '')}
          rowActions={(row, { reload }) => (row.state === 'due' && can('royalties', 'edit') ? [{ label: 'Mark paid', onClick: async () => {
            if (!await confirmDialog(`Mark the ${row.month} royalty (${inr(row.amount)}) as paid today?`)) return;
            try { await api(`/api/royalties/${row._id}`, { method: 'PATCH', body: { state: 'paid', paidDate: todayISO() } }); toast.success('Royalty marked paid'); reload(); } catch (e) { toast.error(e.message); } } }] : [])}
        />
      )}
    </RoleGuard>
  );
}
