'use client';
import ImportData from '@/components/ImportData';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from '@/lib/toast';
import { ArrowLeftRight, AlertTriangle, Check, X } from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, StatCard } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { api } from '@/lib/client';
import StockDaily from '@/components/stock/StockDaily';
import StockCount from '@/components/stock/StockCount';
import { num, fmtDate } from '@/lib/format';

// Physical Stocks format as per client: Date, Karigar, Colour Finish, Thickness, Size L, Size W, QTY, SQFT, Finish, Amount
const FINISH_OPTIONS = ['Natural', 'Honed', 'Polished', 'Flamed', 'Split face', 'Sandblasted', 'Bush Hammered'];
const CAT = [{ value: 'raw', label: 'Raw stone' }, { value: 'finished', label: 'Finished goods' }, { value: 'consumable', label: 'Consumables' }];
const UNITS = ['sq ft', 'sq m', 'pieces', 'CFT', 'tonne', 'litres', 'kg', 'numbers'];

export default function StockPage() {
  const { t, can, perm, session } = useApp();
  const sp = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'items');
  const [reloadKey, setReloadKey] = useState(0);
  const manage = can('stockitems', 'create');
  const isOwner = session?.role === 'owner';

  // Stock item fields matching Physical Stocks format:
  // Colour | Finish | Sizes Length | Sizes Width | Thickness | Edges | Price | Quantity Sqft | Pieces
  const itemFields = [
    { name: 'name', label: 'Colour', required: true, wide: true, placeholder: 'e.g. Kotah Blue, Dholpur Pink' },
    { name: 'finish', label: 'Finish', placeholder: 'e.g. Natural, Honed, Polished, Flamed' },
    { name: 'sizeL', label: 'Sizes Length (mm)', type: 'number', placeholder: '600' },
    { name: 'sizeW', label: 'Sizes Width (mm)', type: 'number', placeholder: '600' },
    { name: 'thickness', label: 'Thickness (mm)', type: 'number', placeholder: '25' },
    { name: 'edges', label: 'Edges', placeholder: 'e.g. Hand Cut, Machine Cut, Bullnose, Chamfered' },
    { name: 'price', label: 'Price (₹)', type: 'number', placeholder: '65', hint: isOwner ? 'Selling rate per sq ft' : undefined },
    { name: 'openingBalance', label: 'Quantity Sqft', type: 'number', default: 0, createOnly: true, hint: 'Opening stock balance' },
    { name: 'pieces', label: 'Pieces', type: 'number', placeholder: '100' },
    { name: 'category', label: 'Stock type', placeholder: 'e.g. Finished goods, Raw stone', default: 'finished' },
    { name: 'unit', label: 'Counted in', type: 'select', options: UNITS, default: 'sq ft' },
    { name: 'minLevel', label: 'Minimum level (alert below this)', type: 'number' },
    { name: 'location', label: 'Location in yard' },
    { name: 'photo', label: 'Photo', type: 'photo' },
  ];

  const itemCols = [
    { key: 'name', label: 'Colour', primary: true, render: (r) => (
      <span>
        {r.name}
        {r.category && r.category !== 'finished' && (
          <span className="ml-2 text-[11px] text-char-400 font-normal">({r.category})</span>
        )}
      </span>
    )},
    { key: 'finish', label: 'Finish', render: (r) => r.finish || '—' },
    { key: 'sizeL', label: 'Sizes Length', render: (r) => r.sizeL ? `${r.sizeL} mm` : '—' },
    { key: 'sizeW', label: 'Sizes Width', render: (r) => r.sizeW ? `${r.sizeW} mm` : '—' },
    { key: 'thickness', label: 'Thickness', render: (r) => r.thickness ? `${r.thickness} mm` : '—' },
    { key: 'edges', label: 'Edges', render: (r) => r.edges || '—' },
    {
      key: 'price',
      label: 'Price',
      align: 'right',
      render: (r) => {
        const val = r.price ?? r.sellRate;
        return val != null && val !== '' ? <b className="text-emerald-700">₹{num(val)}</b> : <span className="text-char-300">—</span>;
      },
    },
    { key: 'balance', label: 'Quantity Sqft', align: 'right', render: (r) => {
      const low = r.minLevel && r.balance < r.minLevel;
      return <span className={low ? 'text-red-600 font-bold' : 'font-semibold'}>{num(r.balance)} {r.unit || 'sq ft'} {low && <AlertTriangle size={12} className="inline -mt-0.5" />}</span>;
    }},
    { key: 'pieces', label: 'Pieces', align: 'right', render: (r) => r.pieces != null ? num(r.pieces) : '—' },
  ];

  return (
    <RoleGuard perm="stockitems">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'items', label: 'Physical Stock' }, { key: 'moves', label: 'Movements' }, { key: 'daily', label: 'Day by day' }, ...(can('stockcounts', 'view') ? [{ key: 'count', label: 'Monthly count' }] : [])]} />
      {tab === 'daily' && <StockDaily />}
      {tab === 'count' && <StockCount />}
      {tab === 'items' && (
        <CrudPage key={'i' + reloadKey} model="stockitems" title={t('stock')} subtitle="Physical Stocks — Colour, Finish, Sizes, Thickness, Edges, Price, Quantity Sqft" label="Stock item" sort="name" headerExtra={<ImportData resource="stockitems" noun="stock items" hint="Colour, Finish, Sizes, Thickness, Edges, Price, Quantity Sqft and Pieces are supported" />}
          fields={itemFields} columns={itemCols}
          canAdd={manage} canEdit={() => manage}
          filters={[{ key: 'category', label: 'All types', options: CAT }, { key: 'low', label: 'Alerts', options: [{ value: '1', label: 'Below minimum' }] }]}
          facets={{ named: 'low' }}
          summary={(rows, { total, facets: f }) => {
            const low = f?.named?.low ?? 0;
            return (
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Items" value={total ?? '…'} />
                <StatCard label="Below minimum" value={low} tone={low ? 'red' : 'green'} />
              </div>
            );
          }}
          rowClass={(r) => (r.minLevel && r.balance < r.minLevel ? 'bg-red-50/60' : '')}
          exportName="physical-stock-report"
          exportColumns={[
            { key: 'name', label: 'Colour' },
            { key: 'finish', label: 'Finish' },
            { key: 'sizeL', label: 'Sizes Length' },
            { key: 'sizeW', label: 'Sizes Width' },
            { key: 'thickness', label: 'Thickness' },
            { key: 'edges', label: 'Edges' },
            { key: 'price', label: 'Price' },
            { key: 'balance', label: 'Quantity Sqft' },
            { key: 'pieces', label: 'Pieces' },
          ]}
          rowActions={(row) => manage ? [{ label: 'Move', icon: <ArrowLeftRight size={14} />, onClick: () => { setTab('moves'); toast('Choose "Add" to record a movement for ' + row.name); } }] : []}
        />
      )}
      {tab === 'moves' && (
        <CrudPage key={'m' + reloadKey} model="stockmovements" headerExtra={<ImportData resource="stockmovements" perm="stockmovements" noun="stock movements" />} title="Stock movements" subtitle="In · out · transfer · damage (damage needs owner approval)" label="Stock movement"
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
          filters={[{ key: 'type', label: 'All movements', options: ['in', 'out', 'transfer', 'damage'] }]}
          onSaved={() => setReloadKey((k) => k + 1)}
          rowActions={(row, { reload }) => (row.status === 'pending' && can('stockmovements', 'approve') ? [
            { label: 'Approve', tone: 'green', icon: <Check size={14} />, onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'stockmovements', id: row._id, action: 'approve' } }); toast.success('Approved'); reload(); } catch (e) { toast.error(e.message); } } },
            { label: 'Reject', icon: <X size={14} />, onClick: async () => { try { await api('/api/approvals', { method: 'POST', body: { model: 'stockmovements', id: row._id, action: 'reject' } }); reload(); } catch (e) { toast.error(e.message); } } },
          ] : [])}
        />
      )}
    </RoleGuard>
  );
}
