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
import { inr, num } from '@/lib/format';

// Physical Stocks format as per client: Date, Karigar, Colour Finish, Thickness, Size L, Size W, QTY, SQFT, Finish, Amount
const FINISH_OPTIONS = ['Natural', 'Honed', 'Polished', 'Flamed', 'Split face', 'Sandblasted', 'Bush Hammered'];
const CAT = [{ value: 'raw', label: 'Raw stone' }, { value: 'finished', label: 'Finished goods' }, { value: 'consumable', label: 'Consumables' }];
const UNITS = ['sq ft', 'sq m', 'pieces', 'CFT', 'tonne', 'litres', 'kg', 'numbers'];

export default function StockPage() {
  const { t, can, perm, session } = useApp();
  const sp = useSearchParams();
  // the first section this person may open (a role may be given the new lists without the stone stock)
  const firstTab = can('stockitems', 'view') ? 'items' : can('stocktools', 'view') ? 'tools' : can('stockmaterials', 'view') ? 'material' : can('stockmachinery', 'view') ? 'machinery' : 'items';
  const [tab, setTab] = useState(sp.get('tab') || firstTab);
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

  // ---- Tools stock: Tool Name | Company | Pieces | Rate
  const toolFields = [
    { name: 'name', label: 'Tool Name', required: true, wide: true, placeholder: 'e.g. 14" blade' },
    { name: 'company', label: 'Company', placeholder: 'e.g. Sona, DK' },
    { name: 'pieces', label: 'Pieces', type: 'number', placeholder: '10' },
    { name: 'rate', label: 'Rate (₹)', type: 'number', placeholder: '1100', hint: 'Price of one piece' },
  ];
  const toolCols = [
    { key: 'name', label: 'Tool Name', primary: true, render: (r) => <b className="text-char-900">{r.name}</b> },
    { key: 'company', label: 'Company', render: (r) => r.company || '—' },
    { key: 'pieces', label: 'Pieces', align: 'right', render: (r) => (r.pieces != null ? num(r.pieces) : '—') },
    { key: 'rate', label: 'Rate', align: 'right', render: (r) => (r.rate != null && r.rate !== '' ? <b className="text-emerald-700">{inr(r.rate)}</b> : <span className="text-char-300">—</span>) },
  ];

  // ---- Material stock: Colour | Top Finish | Edge Finish | Bottom Finish | Size | Thickness | Pieces | Sqft
  const materialFields = [
    { name: 'colour', label: 'Colour', required: true, wide: true, placeholder: 'e.g. Basalt, Grey' },
    { name: 'topFinish', label: 'Top Finish', placeholder: 'e.g. Swan, Leather, Natural' },
    { name: 'edgeFinish', label: 'Edge Finish', placeholder: 'e.g. Uncut, Machine cut' },
    { name: 'bottomFinish', label: 'Bottom Finish', placeholder: 'e.g. Sawn, Natural, Calibrated' },
    { name: 'size', label: 'Size', placeholder: 'e.g. 72x24' },
    { name: 'thickness', label: 'Thickness', placeholder: 'e.g. 20mm' },
    { name: 'pieces', label: 'Pieces', type: 'number', placeholder: '20' },
    { name: 'sqft', label: 'Sqft', type: 'number', placeholder: '240' },
  ];
  const materialCols = [
    { key: 'colour', label: 'Colour', primary: true, render: (r) => <b className="text-char-900">{r.colour}</b> },
    { key: 'topFinish', label: 'Top Finish', render: (r) => r.topFinish || '—' },
    { key: 'edgeFinish', label: 'Edge Finish', render: (r) => r.edgeFinish || '—' },
    { key: 'bottomFinish', label: 'Bottom Finish', render: (r) => r.bottomFinish || '—' },
    { key: 'size', label: 'Size', render: (r) => r.size || '—' },
    { key: 'thickness', label: 'Thickness', render: (r) => r.thickness || '—' },
    { key: 'pieces', label: 'Pieces', align: 'right', render: (r) => (r.pieces != null ? num(r.pieces) : '—') },
    { key: 'sqft', label: 'Sqft', align: 'right', render: (r) => (r.sqft != null ? <b>{num(r.sqft)}</b> : '—') },
  ];

  // ---- Machinery stock: Name | Condition | Repairing cost | Purchase Price | Pieces
  const machineryFields = [
    { name: 'name', label: 'Name', required: true, wide: true, placeholder: 'e.g. Grinder, Hand cutting machine' },
    { name: 'condition', label: 'Condition', placeholder: 'e.g. Ready, Bearing, Armature' },
    { name: 'repairingCost', label: 'Repairing cost (₹)', type: 'number', placeholder: '0' },
    { name: 'purchasePrice', label: 'Purchase Price (₹)', type: 'number', placeholder: '1500' },
    { name: 'pieces', label: 'Pieces', type: 'number', placeholder: '1' },
  ];
  const money = (v) => (v != null && v !== '' ? <b className="text-emerald-700">{inr(v)}</b> : <span className="text-char-300">—</span>);
  const machineryCols = [
    { key: 'name', label: 'Name', primary: true, render: (r) => <b className="text-char-900">{r.name}</b> },
    { key: 'condition', label: 'Condition', render: (r) => (r.condition ? (String(r.condition).toLowerCase() === 'ready' ? <Badge tone="green">{r.condition}</Badge> : <Badge tone="amber">{r.condition}</Badge>) : '—') },
    { key: 'repairingCost', label: 'Repairing cost', align: 'right', render: (r) => money(r.repairingCost) },
    { key: 'purchasePrice', label: 'Purchase Price', align: 'right', render: (r) => money(r.purchasePrice) },
    { key: 'pieces', label: 'Pieces', align: 'right', render: (r) => (r.pieces != null ? num(r.pieces) : '—') },
  ];

  const sections = [
    ...(can('stocktools', 'view') ? [{ key: 'tools', label: 'Tools stock' }] : []),
    ...(can('stockmaterials', 'view') ? [{ key: 'material', label: 'Material stock' }] : []),
    ...(can('stockmachinery', 'view') ? [{ key: 'machinery', label: 'Machinery stock' }] : []),
  ];

  return (
    <RoleGuard perm={['stockitems', 'stocktools', 'stockmaterials', 'stockmachinery']}>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'items', label: 'Physical Stock' }, { key: 'daily', label: 'Day by day' }, ...(can('stockcounts', 'view') ? [{ key: 'count', label: 'Monthly count' }] : []), ...sections]} />
      {tab === 'daily' && <StockDaily />}
      {tab === 'count' && <StockCount />}
      {tab === 'tools' && (
        <CrudPage key="t" model="stocktools" title="Tools stock" subtitle="Blades and other tools: name, company, pieces and rate" label="Tool" sort="name"
          headerExtra={<ImportData resource="stocktools" noun="tools" hint="Tool Name, Company, Pieces and Rate" />}
          searchPlaceholder="Search tool or company..." fields={toolFields} columns={toolCols}
          canAdd={can('stocktools', 'create')} canEdit={() => can('stocktools', 'edit')}
          facets={{ sum: 'pieces' }}
          summary={(rows, { total, facets: f }) => (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Tools" value={total ?? '…'} />
              <StatCard label="Total pieces" value={num(f?.sums?.pieces ?? 0)} />
            </div>
          )}
          exportName="tools-stock" exportColumns={[{ key: 'name', label: 'Tool Name' }, { key: 'company', label: 'Company' }, { key: 'pieces', label: 'Pieces' }, { key: 'rate', label: 'Rate' }]}
        />
      )}
      {tab === 'material' && (
        <CrudPage key="m" model="stockmaterials" title="Material stock" subtitle="Colour, finishes, size, thickness, pieces and sqft" label="Material" sort="colour"
          headerExtra={<ImportData resource="stockmaterials" noun="material stock" hint="Colour, Top Finish, Edge Finish, Bottom Finish, Size, Thickness, Pieces and Sqft" />}
          searchPlaceholder="Search colour, finish, size..." fields={materialFields} columns={materialCols}
          canAdd={can('stockmaterials', 'create')} canEdit={() => can('stockmaterials', 'edit')}
          facets={{ sum: 'pieces,sqft' }}
          summary={(rows, { total, facets: f }) => (
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Rows" value={total ?? '…'} />
              <StatCard label="Total pieces" value={num(f?.sums?.pieces ?? 0)} />
              <StatCard label="Total sqft" value={num(f?.sums?.sqft ?? 0)} />
            </div>
          )}
          exportName="material-stock" exportColumns={[{ key: 'colour', label: 'Colour' }, { key: 'topFinish', label: 'Top Finish' }, { key: 'edgeFinish', label: 'Edge Finish' }, { key: 'bottomFinish', label: 'Bottom Finish' }, { key: 'size', label: 'Size' }, { key: 'thickness', label: 'Thickness' }, { key: 'pieces', label: 'Pieces' }, { key: 'sqft', label: 'Sqft' }]}
        />
      )}
      {tab === 'machinery' && (
        <CrudPage key="y" model="stockmachinery" title="Machinery stock" subtitle="Small machines: name, condition, repairing cost, purchase price and pieces" label="Machine" sort="name"
          headerExtra={<ImportData resource="stockmachinery" noun="machinery" hint="Name, Condition, Repairing cost, Purchase Price and Pieces" />}
          searchPlaceholder="Search machine or condition..." fields={machineryFields} columns={machineryCols}
          canAdd={can('stockmachinery', 'create')} canEdit={() => can('stockmachinery', 'edit')}
          facets={{ sum: 'pieces' }}
          summary={(rows, { total, facets: f }) => (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Machines" value={total ?? '…'} />
              <StatCard label="Total pieces" value={num(f?.sums?.pieces ?? 0)} />
            </div>
          )}
          exportName="machinery-stock" exportColumns={[{ key: 'name', label: 'Name' }, { key: 'condition', label: 'Condition' }, { key: 'repairingCost', label: 'Repairing cost' }, { key: 'purchasePrice', label: 'Purchase Price' }, { key: 'pieces', label: 'Pieces' }]}
        />
      )}
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
