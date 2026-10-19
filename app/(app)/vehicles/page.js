'use client';
import ImportData from '@/components/ImportData';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import dynamic from 'next/dynamic';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, StatCard } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { fmtDate, todayISO, addDays, num2, inr, monthOf, daysInMonth } from '@/lib/format';
import T from '@/components/T';

const load = () => <div className="h-64 skeleton" />;
const DieselTrendChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.DieselTrendChart), { ssr: false, loading: load });
const VehicleDieselChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.VehicleDieselChart), { ssr: false, loading: load });
const EfficiencyChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.EfficiencyChart), { ssr: false, loading: load });
const PapersChart = dynamic(() => import('@/components/charts/OpsCharts').then((m) => m.PapersChart), { ssr: false, loading: load });

// the last n months, oldest first
const monthsBack = (month, n) => { const [y, m] = month.split('-').map(Number); return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)).toISOString().slice(0, 7)); };

const KINDS = ['Truck', 'Tractor', 'Loader', 'Crane', 'Other'];
const EXP = [['insuranceExpiry', 'Insurance'], ['fitnessExpiry', 'Fitness'], ['permitExpiry', 'Permit'], ['pucExpiry', 'PUC']];

export default function VehiclesPage() {
  const { t, tr } = useApp();
  const [tab, setTab] = useState('vehicles');
  const [span, setSpan] = useState(6); // months shown in the report
  const [pick, setPick] = useState(''); // vehicle whose diesel use is drawn trip by trip
  const today = todayISO();
  const month = monthOf(today);
  const expBadge = (d) => (d ? <Badge tone={d < today ? 'red' : d <= addDays(today, 7) ? 'red' : d <= addDays(today, 30) ? 'amber' : 'green'}>{fmtDate(d)}</Badge> : <span className="text-char-300">—</span>);

  // papers expiring within 30 days: the server picks them (named filter), the page does not scan every vehicle
  const soonQ = useFetch(tab === 'vehicles' ? '/api/vehicles?expiring=30&limit=50' : null);
  // average diesel use per vehicle (one aggregate), to highlight a vehicle burning more than its normal
  const avgQ = useFetch(tab === 'trips' ? '/api/vehicletrips/facets?by=vehicleId&sum=dieselPerUnit&measured=1' : null);
  // the reports
  const months = monthsBack(month, span);
  const range = `from=${months[0]}-01&to=${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const report = tab === 'report';
  const allV = useFetch('/api/vehicles?sort=name&limit=100'); // names for the report and the papers chart
  const trend = useFetch(report ? `/api/vehicletrips/facets?bucket=month&sum=dieselLitres,dieselAmount,km,hours&${range}` : null);
  const perV = useFetch(report ? `/api/vehicletrips/facets?by=vehicleId&sum=dieselLitres,dieselAmount&${range}` : null);
  const nameOf = Object.fromEntries((allV.data || []).map((v) => [v._id, v.name]));
  const vRows = Object.entries(perV.data?.groups || {}).map(([id, g]) => ({ id, name: nameOf[id] || '—', litres: g.sums.dieselLitres, amount: g.sums.dieselAmount, trips: g.n })).sort((a, b) => b.litres - a.litres);
  const chosen = pick || vRows[0]?.id || '';
  const tripsQ = useFetch(report && chosen ? `/api/vehicletrips?vehicleId=${chosen}&measured=1&sort=-date&limit=40` : null);
  const measuredTrips = (tripsQ.data || []).filter((r) => r.dieselPerUnit > 0);
  const unit = measuredTrips.filter((r) => r.hours).length >= measuredTrips.filter((r) => !r.hours).length ? 'h' : 'km'; // litres per hour (loaders) or per km (trucks)
  const points = measuredTrips.filter((r) => (unit === 'h' ? r.hours : !r.hours && r.km)).reverse().map((r) => ({ date: r.date, value: r.dieselPerUnit, litres: r.dieselLitres, work: r.work }));
  const normal = points.length ? points.reduce((a, p) => a + p.value, 0) / points.length : 0;
  const trendRows = months.map((m) => ({ month: m, litres: trend.data?.groups?.[m]?.sums?.dieselLitres || 0, amount: trend.data?.groups?.[m]?.sums?.dieselAmount || 0, trips: trend.data?.groups?.[m]?.n || 0 }));
  const papers = EXP.map(([k, l]) => {
    const rows = allV.data || [];
    const soon = addDays(today, 30);
    return { name: l, expired: rows.filter((v) => v[k] && v[k] < today).length, soon: rows.filter((v) => v[k] && v[k] >= today && v[k] <= soon).length, ok: rows.filter((v) => v[k] && v[k] > soon).length, none: rows.filter((v) => !v[k]).length };
  });
  const avg = Object.fromEntries(Object.entries(avgQ.data?.groups || {}).map(([id, g]) => [id, g.n ? g.sums.dieselPerUnit / g.n : 0]));

  return (
    <RoleGuard perm="vehicles">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'vehicles', label: 'Vehicles & papers' }, { key: 'trips', label: 'Trips & diesel' }, { key: 'report', label: 'Reports' }]} />
      {tab === 'vehicles' && (
        <CrudPage key="vehicles" model="vehicles" title={t('vehicles')} subtitle="Every truck, tractor, loader and crane — papers and expiry dates" label="Vehicle" sort="name" headerExtra={<ImportData resource="vehicles" noun="vehicles" hint="name and type are required" />}
          fields={[
            { name: 'name', label: 'Name', required: true, placeholder: 'Truck RJ06 GA 4521' }, { name: 'regNo', label: 'Registration no.' }, { name: 'kind', label: 'Type', type: 'select', options: KINDS, required: true },
            { name: 'driverCode', label: 'Regular driver', type: 'ref', hint: 'Employees whose Designation is Driver. A trip of this vehicle takes this driver unless you pick another', ref: { model: 'employees', valueKey: 'empCode', label: (e) => `${e.name} (${e.job})`, query: { status: 'active', designation: 'Driver' } } },
            ...EXP.map(([k, l]) => ({ name: k, label: tr('{l} expiry', { l }), type: 'date' })),
            { name: 'rcPhoto', label: 'RC photo', type: 'photo' }, { name: 'notes', label: 'Notes', wide: true },
          ]}
          columns={[{ key: 'name', label: 'Vehicle', primary: true }, { key: 'kind', label: 'Type' }, { key: 'driverName', label: 'Driver', render: (r) => r.driverName || '—' }, ...EXP.map(([k, l]) => ({ key: k, label: l, render: (r) => expBadge(r[k]) }))]}
          summary={() => {
            const papersOf = (test) => (soonQ.data || []).flatMap((v) => EXP.filter(([k]) => v[k] && test(v[k])).map(([k, l]) => `${v.name}: ${l} ${fmtDate(v[k])}`));
            const gone = papersOf((d) => d < today);
            const soon = papersOf((d) => d >= today && d <= addDays(today, 30));
            return (
              <div className="space-y-3">
                {gone.length ? <div className="rounded-xl bg-red-50 border border-red-200 text-red-900 text-sm px-3 py-2"><div className="font-bold flex items-center gap-1"><AlertTriangle size={14} /><T>Expired</T></div>{gone.map((s) => <div key={s}>{s}</div>)}</div> : null}
                {soon.length ? <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2"><div className="font-bold flex items-center gap-1"><AlertTriangle size={14} /><T> Expiring within 30 days</T></div>{soon.map((s) => <div key={s}>{s}</div>)}</div> : null}
                {(allV.data || []).length > 0 && <PapersChart data={papers} />}
              </div>
            );
          }} />
      )}
      {tab === 'trips' && (
        <CrudPage key="trips" model="vehicletrips" headerExtra={<ImportData resource="vehicletrips" perm="vehicletrips" noun="trips and diesel" />} title="Trips & diesel" subtitle="Diesel used per hour or per km — extra use stands out" label="Trip" sort="-date,-createdAt"
          fields={[
            { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'vehicleId', label: 'Vehicle', type: 'ref', required: true, ref: { model: 'vehicles', nameField: 'vehicleName' } },
            { name: 'driverCode', label: 'Driver', type: 'ref', hint: 'Employees whose Designation is Driver (set it on the Employee form)', ref: { model: 'employees', valueKey: 'empCode', label: (e) => `${e.name} (${e.job})`, query: { status: 'active', designation: 'Driver' } } }, { name: 'work', label: 'Trip or work done', wide: true, placeholder: 'Block shifted quarry → factory' },
            { name: 'hours', label: 'Hour-meter hours', type: 'number' }, { name: 'km', label: 'Kilometres', type: 'number' },
            { name: 'dieselLitres', label: 'Diesel filled (litres)', type: 'number', required: true }, { name: 'dieselAmount', label: 'Diesel amount (₹)', type: 'number' },
          ]}
          columns={[
            { key: 'vehicleName', label: 'Vehicle', primary: true }, { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) }, { key: 'driverName', label: 'Driver', render: (r) => r.driverName || '—' }, { key: 'work', label: 'Work', wide: true },
            { key: 'use', label: 'Hours / km', render: (r) => (r.hours ? `${r.hours} h` : r.km ? `${r.km} km` : '—') }, { key: 'dieselLitres', label: 'Diesel (L)' },
            { key: 'dieselPerUnit', label: 'Per hr / km', render: (r) => { const a = avg[r.vehicleId]; const high = a && r.dieselPerUnit > a * 1.3; return <span className={high ? 'text-red-600 font-bold' : ''}>{num2(r.dieselPerUnit)}{high && ' ⚠ high'}</span>; } },
          ]}
          rowClass={(r) => { const a = avg[r.vehicleId]; return a && r.dieselPerUnit > a * 1.3 ? 'bg-red-50/60' : ''; }} exportName="vehicle-trips" />
      )}

      {tab === 'report' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold"><T>Diesel and trips</T></h2>
            <select className="input w-auto" value={span} onChange={(e) => setSpan(Number(e.target.value))} aria-label="Period">
              {[[3, 'Last 3 months'], [6, 'Last 6 months'], [12, 'Last 12 months']].map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Diesel filled" value={`${num2(trend.data?.sums?.dieselLitres ?? 0)} L`} tone="terra" />
            <StatCard label="Diesel amount" value={inr(trend.data?.sums?.dieselAmount ?? 0)} />
            <StatCard label="Trips" value={trend.data?.total ?? 0} />
            <StatCard label="Price per litre" value={trend.data?.sums?.dieselLitres ? `₹${num2(trend.data.sums.dieselAmount / trend.data.sums.dieselLitres)}` : '—'} />
          </div>
          <DieselTrendChart months={trendRows} />
          <VehicleDieselChart rows={vRows} />
          <EfficiencyChart points={points} unit={unit} normal={normal} title={`${tr('Diesel use per trip')} (${tr('litres per')} ${unit === 'h' ? tr('hour') : 'km'})`}
            right={vRows.length > 0 && (
              <select className="input w-auto max-w-[11rem]" value={chosen} onChange={(e) => setPick(e.target.value)} aria-label={tr('Vehicle')}>
                {vRows.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )} />
        </div>
      )}
    </RoleGuard>
  );
}
