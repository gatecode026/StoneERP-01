'use client';
import ImportData from '@/components/ImportData';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { fmtDate, todayISO, addDays, num2 } from '@/lib/format';

const KINDS = ['Truck', 'Tractor', 'Loader', 'Crane', 'Other'];
const EXP = [['insuranceExpiry', 'Insurance'], ['fitnessExpiry', 'Fitness'], ['permitExpiry', 'Permit'], ['pucExpiry', 'PUC']];

export default function VehiclesPage() {
  const { t } = useApp();
  const [tab, setTab] = useState('vehicles');
  const today = todayISO();
  const expBadge = (d) => (d ? <Badge tone={d < today ? 'red' : d <= addDays(today, 7) ? 'red' : d <= addDays(today, 30) ? 'amber' : 'green'}>{fmtDate(d)}</Badge> : <span className="text-char-300">—</span>);

  // papers expiring within 30 days: the server picks them (named filter), the page does not scan every vehicle
  const soonQ = useFetch(tab === 'vehicles' ? '/api/vehicles?expiring=30&limit=50' : null);
  // average diesel use per vehicle (one aggregate), to highlight a vehicle burning more than its normal
  const avgQ = useFetch(tab === 'trips' ? '/api/vehicletrips/facets?by=vehicleId&sum=dieselPerUnit&measured=1' : null);
  const avg = Object.fromEntries(Object.entries(avgQ.data?.groups || {}).map(([id, g]) => [id, g.n ? g.sums.dieselPerUnit / g.n : 0]));

  return (
    <RoleGuard perm="vehicles">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'vehicles', label: 'Vehicles & papers' }, { key: 'trips', label: 'Trips & diesel' }]} />
      {tab === 'vehicles' ? (
        <CrudPage model="vehicles" title={t('vehicles')} subtitle="Every truck, tractor, loader and crane — papers and expiry dates" label="Vehicle" sort="name" headerExtra={<ImportData resource="vehicles" noun="vehicles" hint="name and type are required" />}
          fields={[
            { name: 'name', label: 'Name', required: true, placeholder: 'Truck RJ06 GA 4521' }, { name: 'regNo', label: 'Registration no.' }, { name: 'kind', label: 'Type', type: 'select', options: KINDS, required: true },
            ...EXP.map(([k, l]) => ({ name: k, label: `${l} expiry`, type: 'date' })),
            { name: 'rcPhoto', label: 'RC photo', type: 'photo' }, { name: 'notes', label: 'Notes', wide: true },
          ]}
          columns={[{ key: 'name', label: 'Vehicle', primary: true }, { key: 'kind', label: 'Type' }, ...EXP.map(([k, l]) => ({ key: k, label: l, render: (r) => expBadge(r[k]) }))]}
          summary={() => {
            const soon = (soonQ.data || []).flatMap((v) => EXP.filter(([k]) => v[k] && v[k] <= addDays(today, 30)).map(([k, l]) => `${v.name}: ${l} ${fmtDate(v[k])}`));
            return soon.length ? <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2"><div className="font-bold flex items-center gap-1"><AlertTriangle size={14} /> Expiring within 30 days</div>{soon.map((s) => <div key={s}>{s}</div>)}</div> : null;
          }} />
      ) : (
        <CrudPage model="vehicletrips" headerExtra={<ImportData resource="vehicletrips" perm="vehicletrips" noun="trips and diesel" />} title="Trips & diesel" subtitle="Diesel used per hour or per km — extra use stands out" label="Trip" sort="-date,-createdAt"
          fields={[
            { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'vehicleId', label: 'Vehicle', type: 'ref', required: true, ref: { model: 'vehicles', nameField: 'vehicleName' } },
            { name: 'driverCode', label: 'Driver', type: 'ref', ref: { model: 'employees', valueKey: 'empCode', label: (e) => `${e.name} (${e.job})`, query: { status: 'active' } } }, { name: 'work', label: 'Trip or work done', wide: true, placeholder: 'Block shifted quarry → factory' },
            { name: 'hours', label: 'Hour-meter hours', type: 'number' }, { name: 'km', label: 'Kilometres', type: 'number' },
            { name: 'dieselLitres', label: 'Diesel filled (litres)', type: 'number', required: true }, { name: 'dieselAmount', label: 'Diesel amount (₹)', type: 'number' },
          ]}
          columns={[
            { key: 'vehicleName', label: 'Vehicle', primary: true }, { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) }, { key: 'work', label: 'Work', wide: true },
            { key: 'use', label: 'Hours / km', render: (r) => (r.hours ? `${r.hours} h` : r.km ? `${r.km} km` : '—') }, { key: 'dieselLitres', label: 'Diesel (L)' },
            { key: 'dieselPerUnit', label: 'Per hr / km', render: (r) => { const a = avg[r.vehicleId]; const high = a && r.dieselPerUnit > a * 1.3; return <span className={high ? 'text-red-600 font-bold' : ''}>{num2(r.dieselPerUnit)}{high && ' ⚠ high'}</span>; } },
          ]}
          rowClass={(r) => { const a = avg[r.vehicleId]; return a && r.dieselPerUnit > a * 1.3 ? 'bg-red-50/60' : ''; }} exportName="vehicle-trips" />
      )}
    </RoleGuard>
  );
}
