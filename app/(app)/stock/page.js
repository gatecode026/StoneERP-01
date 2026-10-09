'use client';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeftRight, AlertTriangle, Check, X } from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, StatCard } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { api } from '@/lib/client';
import { inr, num, fmtDate, sum } from '@/lib/format';

const CAT = [{ value: 'raw', label: 'Raw stone' }, { value: 'finished', label: 'Finished goods' }, { value: 'consumable', label: 'Consumables' }];
const UNITS = ['sq ft', 'sq m', 'pieces', 'CFT', 'tonne', 'litres', 'kg', 'numbers'];

export default function StockPage() {
  const { t, role } = useApp();
  const [tab, setTab] = useState('items');
  const [reloadKey, setReloadKey] = useState(0);
  const money = role === 'owner' || role === 'manager' || role === 'accountant';
  const manage = role !== 'salesperson';

  const itemFields = [
    { name: 'name', label: 'Item name', required: true, wide: true },
    { name: 'category', label: 'Stock type', type: 'select', options: CAT, required: true, default: 'finished' },
    { name: 'unit', label: 'Counted in', type: 'select', options: UNITS, required: true, default: 'sq ft' },
    { name: 'size', label: 'Size (mm)', placeholder: '600×600' },
    { name: 'thickness', label: 'Thickness (mm)', type: 'number' },
    { name: 'finish', label: 'Finish', type: 'select', options: ['Natural', 'Honed', 'Polished', 'Flamed', 'Split face', 'Sandblasted'] },
    { name: 'grade', label: 'Grade', type: 'select', options: ['A', 'B', 'C'] },
    { name: 'location', label: 'Location in yard' },
    { name: 'balance', label: 'Opening balance', type: 'number', default: 0, readOnlyOnEdit: true, hint: 'Later changes happen through stock movements' },
    { name: 'minLevel', label: 'Minimum level (alert below this)', type: 'number' },
    { name: 'sellRate', label: 'Selling rate (₹)', type: 'number' },
    ...(money ? [{ name: 'costRate', label: 'Cost rate (₹)', type: 'number' }] : []),
    { name: 'photo', label: 'Photo', type: 'photo' },
  ];

  const itemCols = [
    { key: 'name', label: 'Item', primary: true, render: (r) => <span>{r.name}<div className="text-[11px] text-char-500 font-normal">{[r.size, r.thickness && `${r.thickness} mm`, r.finish, r.grade && `Grade ${r.grade}`].filter(Boolean).join(' · ')}</div></span> },
    { key: 'category', label: 'Type', render: (r) => CAT.find((c) => c.value === r.category)?.label },
    { key: 'balance', label: 'Balance', align: 'right', render: (r) => {
      const low = r.minLevel && r.balance < r.minLevel;
      return <span className={low ? 'text-red-600 font-bold' : 'font-semibold'}>{num(r.balance)} {r.unit} {low && <AlertTriangle size={12} className="inline -mt-0.5" />}</span>;
    } },
    { key: 'minLevel', label: 'Minimum', render: (r) => (r.minLevel ? `${num(r.minLevel)} ${r.unit}` : '—') },
    ...(money ? [{ label: 'Value', align: 'right', render: (r) => inr((r.balance || 0) * (r.costRate || 0)) }] : []),
    { key: 'location', label: 'Location' },
  ];

  return (
    <RoleGuard perm="stock">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'items', label: 'Balance' }, { key: 'moves', label: 'Movements' }]} />
      {tab === 'items' ? (
        <CrudPage key={'i' + reloadKey} model="stockitems" title={t('stock')} subtitle="Live balance of every item" label="Stock item" sort="category,name"
          fields={itemFields} columns={itemCols} searchKeys={['name', 'size', 'location', 'finish']}
          canAdd={manage} canEdit={() => manage}
          filters={[{ key: 'category', label: 'All types', options: CAT }, { key: 'low', label: 'Alerts', options: [{ value: '1', label: 'Below minimum' }], test: (r) => r.minLevel && r.balance < r.minLevel }]}
          summary={(rows, all) => {
            const low = all.filter((r) => r.minLevel && r.balance < r.minLevel);
            return (
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Items" value={all.length} />
                {money ? <StatCard label="Stock value" value={inr(sum(all, (r) => (r.balance || 0) * (r.costRate || 0)))} /> : <StatCard label="Below minimum" value={low.length} tone={low.length ? 'red' : 'green'} />}
                {money && <StatCard label="Below minimum" value={low.length} sub={low.map((x) => x.name).join(', ')} tone={low.length ? 'red' : 'green'} />}
              </div>
            );
          }}
          rowClass={(r) => (r.minLevel && r.balance < r.minLevel ? 'bg-red-50/60' : '')}
          exportName="stock-report"
          exportColumns={[{ key: 'name', label: 'Item' }, { key: 'category', label: 'Type' }, { key: 'unit', label: 'Unit' }, { key: 'balance', label: 'Balance' }, { key: 'minLevel', label: 'Minimum' }, { key: 'location', label: 'Location' }]}
          rowActions={(row) => manage ? [{ label: 'Move', icon: <ArrowLeftRight size={14} />, onClick: () => { setTab('moves'); toast('Choose "Add" to record a movement for ' + row.name); } }] : []}
        />
      ) : (
        <CrudPage key={'m' + reloadKey} model="stockmovements" title="Stock movements" subtitle="In · out · transfer · damage (damage needs owner approval)" label="Stock movement"
          sort="-date,-createdAt" canAdd={manage} canEdit={() => false} allowVoid={false}
          fields={[
            { name: 'date', label: 'Date', type: 'date', required: true },
            { name: 'type', label: 'Movement', type: 'select', required: true, default: 'in', options: [{ value: 'in', label: 'Stock in (purchase / production)' }, { value: 'out', label: 'Stock out (sale / use)' }, { value: 'transfer', label: 'Transfer yard ↔ factory' }, { value: 'damage', label: 'Damage / breakage (needs approval)' }] },
            { name: 'itemId', label: 'Item', type: 'ref', required: true, wide: true, ref: { model: 'stockitems', nameField: 'itemName', label: (x) => `${x.name} (${num(x.balance)} ${x.unit})` } },
            { name: 'qty', label: 'Quantity', type: 'number', required: true },
            { name: 'location', label: 'Move to / location', show: (f) => f.type === 'transfer', placeholder: 'e.g. Factory bay 2' },
            { name: 'ref', label: 'Reference', placeholder: 'Bill / order no.' },
            { name: 'note', label: 'Reason / note', type: 'textarea', wide: true },
          ]}
          columns={[
            { key: 'itemName', label: 'Item', primary: true },
            { key: 'type', label: 'Movement', render: (r) => <Badge tone={r.type === 'in' ? 'green' : r.type === 'out' ? 'blue' : r.type === 'damage' ? 'red' : 'gray'}>{r.type}</Badge> },
            { key: 'qty', label: 'Qty', align: 'right', render: (r) => num(r.qty) },
            { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
            { key: 'ref', label: 'Reference', render: (r) => r.ref || '—' },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
            { key: 'createdBy', label: 'By' },
          ]}
          searchKeys={['itemName', 'ref', 'note']}
          filters={[{ key: 'type', label: 'All movements', options: ['in', 'out', 'transfer', 'damage'] }]}
          onSaved={() => setReloadKey((k) => k + 1)}
          rowActions={(row, { reload }) => (row.status === 'pending' && (role === 'owner' || role === 'manager') ? [
            { label: 'Approve', tone: 'green', icon: <Check size={14} />, onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'stockmovements', id: row._id, action: 'approve' } }); toast.success('Approved'); reload(); } catch (e) { toast.error(e.message); } } },
            { label: 'Reject', icon: <X size={14} />, onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'stockmovements', id: row._id, action: 'reject' } }); reload(); } catch (e) { toast.error(e.message); } } },
          ] : [])}
        />
      )}
    </RoleGuard>
  );
}
