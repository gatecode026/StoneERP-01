'use client';
import ImportData from '@/components/ImportData';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from '@/lib/toast';
import { AlertTriangle } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, StatCard } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { api } from '@/lib/client';
import StockDaily from '@/components/stock/StockDaily';
import StockCount from '@/components/stock/StockCount';
import { num } from '@/lib/format';

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

  const STOCK_STATUS_OPTIONS = [
    { value: 'in_stock', label: 'In Stock' },
    { value: 'out_of_stock', label: 'Out of Stock' },
  ];

  // Stock item fields matching Physical Stocks format:
  // Colour | Finish | Sizes Length | Sizes Width | Thickness | Edges | Price | Quantity Sqft | Pieces
  const itemFields = [
    { name: 'name', label: 'Colour', required: true, wide: true, placeholder: 'e.g. Kotah Blue, Dholpur Pink' },
    { name: 'finish', label: 'Finish', placeholder: 'e.g. Natural, Honed, Polished, Flamed' },
    { name: 'sizeL', label: 'Sizes Length (mm)', type: 'number', placeholder: '600' },
    { name: 'sizeW', label: 'Sizes Width (mm)', type: 'number', placeholder: '600' },
    { name: 'thickness', label: 'Thickness (mm)', placeholder: 'e.g. 25, 20-25' },
    { name: 'edges', label: 'Edges', placeholder: 'e.g. Hand Cut, Machine Cut, Bullnose, Chamfered' },
    { name: 'price', label: 'Price (₹)', type: 'number', placeholder: '65', hint: isOwner ? 'Selling rate per sq ft' : undefined },
    { name: 'openingBalance', label: 'Quantity Sqft', type: 'number', default: 0, createOnly: true, hint: 'Opening stock balance' },
    { name: 'pieces', label: 'Pieces', type: 'number', placeholder: '100' },
    { name: 'category', label: 'Stock type', placeholder: 'e.g. Finished goods, Raw stone', default: 'finished' },
    { name: 'stockStatus', label: 'Stock status', type: 'select', options: STOCK_STATUS_OPTIONS, default: 'in_stock' },
    { name: 'unit', label: 'Counted in', type: 'select', options: UNITS, default: 'sq ft' },
    { name: 'minLevel', label: 'Minimum level (alert below this)', type: 'number' },
    { name: 'location', label: 'Location in yard' },
    { name: 'photo', label: 'Photo', type: 'photo' },
  ];

  const itemCols = [
    { key: 'name', label: 'Colour', primary: true, render: (r) => (
      <span>
        <div className="font-semibold text-char-900">{r.name}</div>
        {r.karigar && (
          <div className="text-[11px] text-char-500 font-normal">By {r.karigar}</div>
        )}
        {r.category && r.category !== 'finished' && (
          <span className="text-[11px] text-char-400 font-normal">({r.category})</span>
        )}
      </span>
    )},
    { key: 'finish', label: 'Finish', render: (r) => r.finish || '—' },
    { key: 'sizeL', label: 'Sizes Length', render: (r) => r.sizeL ? `${r.sizeL} mm` : '—' },
    { key: 'sizeW', label: 'Sizes Width', render: (r) => r.sizeW ? `${r.sizeW} mm` : '—' },
    { key: 'thickness', label: 'Thickness', render: (r) => r.thickness ? (String(r.thickness).toLowerCase().includes('mm') ? r.thickness : `${r.thickness} mm`) : '—' },
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
    {
      key: 'stockStatus',
      label: 'Status',
      align: 'center',
      render: (r) => {
        const isOut = r.stockStatus === 'out_of_stock';
        return (
          <Badge tone={isOut ? 'red' : 'green'}>
            {isOut ? 'Out of Stock' : 'In Stock'}
          </Badge>
        );
      },
    },
  ];

  return (
    <RoleGuard perm="stockitems">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'items', label: 'Physical Stock' }, { key: 'daily', label: 'Day by day' }, ...(can('stockcounts', 'view') ? [{ key: 'count', label: 'Monthly count' }] : [])]} />
      {tab === 'daily' && <StockDaily />}
      {tab === 'count' && <StockCount />}
      {tab === 'items' && (
        <CrudPage key={'i' + reloadKey} model="stockitems" title={t('stock')} subtitle="Physical Stocks — Colour, Finish, Sizes, Thickness, Edges, Price, Quantity Sqft" label="Stock item" sort="name" headerExtra={<ImportData resource="stockitems" noun="stock items" hint="Colour, Finish, Sizes, Thickness, Edges, Price, Quantity Sqft and Pieces are supported" />}
          searchPlaceholder="Search colour, finish, sizes, thickness..."
          fields={itemFields} columns={itemCols}
          canAdd={manage} canEdit={() => manage}
          loadExtra={(full) => ({ stockStatus: full?.stockStatus || 'in_stock' })}
          filters={[
            { key: 'category', label: 'All types', options: CAT },
            { key: 'stockStatus', label: 'All stock status', options: STOCK_STATUS_OPTIONS },
            { key: 'low', label: 'Alerts', options: [{ value: '1', label: 'Below minimum' }] },
          ]}
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
            { key: 'stockStatus', label: 'Status' },
          ]}
        />
      )}
    </RoleGuard>
  );
}
