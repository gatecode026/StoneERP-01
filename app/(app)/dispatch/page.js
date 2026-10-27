'use client';
import ImportData from '@/components/ImportData';
import { confirmDialog, promptDialog } from '@/components/Dialogs';
import { useState } from 'react';
import toast from '@/lib/toast';
import { LogOut, LogIn, Printer, MessageCircle, Plus, Banknote, Truck, Search, RefreshCw, Trash2 } from 'lucide-react';
import CrudPage from '@/components/CrudPage';
import { RoleGuard, Tabs, Badge, StatCard, DataList } from '@/components/ui';
import { useApp, useFetch } from '@/components/Providers';
import { api, openWA } from '@/lib/client';
import { apiAsk } from '@/components/askApi';
import LoadingSheet from '@/components/dispatch/LoadingSheet';
import { TruckOutModal, TruckInModal, AddTruckModal } from '@/components/dispatch/TruckModals';
import { inr, num, fmtDate, todayISO, sum } from '@/lib/format';
import T from '@/components/T';

// a weight or an amount cannot be below zero; the loaded truck cannot weigh less than the empty one
const nonNegative = (name) => (f) => (f[name] !== '' && f[name] != null && Number(f[name]) < 0 ? 'Cannot be below zero' : '');
const weightProblem = (f) => (f.emptyWeight && f.loadedWeight && Number(f.loadedWeight) < Number(f.emptyWeight) ? 'Loaded weight is less than the empty weight' : '');

export default function DispatchPage() {
  const { tr, can, session } = useApp();
  const [tab, setTab] = useState('trucks');
  const [truckReloadKey, setTruckReloadKey] = useState(0);
  const [loadOpen, setLoadOpen] = useState(false); // customer loading slip sheet
  const [reloadKey, setReloadKey] = useState(0);

  // Modals for Daily Truck Updates
  const [outTruck, setOutTruck] = useState(null);
  const [inTruck, setInTruck] = useState(null);
  const [addTruckOpen, setAddTruckOpen] = useState(false);

  // Filter state for trucks
  const [truckSearch, setTruckSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Truck Updates API query
  const tuQ = useFetch(`/api/truck-updates?k=${truckReloadKey}`);
  const trucksData = tuQ.data?.trucks || [];
  const tripsData = tuQ.data?.trips || [];
  const stats = tuQ.data?.stats || { totalTrucks: 0, inFactory: 0, onTrip: 0, todayTrips: 0, todayKm: 0, todayFuel: 0 };

  const reloadTrucks = () => {
    setTruckReloadKey((k) => k + 1);
    tuQ.reload();
  };

  // the Freight tab asks the server for per-transporter totals
  const fr = useFetch(tab === 'freight' ? '/api/dispatches/freight' : null);
  const canMark = can('dispatches', 'approve');

  // Filter trucks by search and status
  const filteredTrucks = trucksData.filter((tr) => {
    const q = truckSearch.trim().toLowerCase();
    const matchSearch =
      !q ||
      tr.name?.toLowerCase().includes(q) ||
      tr.regNo?.toLowerCase().includes(q) ||
      tr.driverName?.toLowerCase().includes(q) ||
      tr.activeTrip?.driverName?.toLowerCase().includes(q);
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'in' && tr.status !== 'out') ||
      (statusFilter === 'out' && tr.status === 'out');
    return matchSearch && matchStatus;
  });

  // customer loading slips fields
  const outFields = [
    { name: 'truckNo', label: 'Truck number', required: true, placeholder: 'RJ06 XX 0000', rule: 'truckNo' },
    { name: 'driverName', label: 'Driver name', rule: 'name' },
    { name: 'driverMobile', label: 'Driver mobile', type: 'tel', rule: 'mobile', hint: '10 digits, starting with 6, 7, 8 or 9' },
    { name: 'transporter', label: 'Transporter', rule: 'partyName' },
    { name: 'freight', label: 'Freight amount (₹)', type: 'number', validate: nonNegative('freight') },
    { name: 'eway', label: 'E-way bill number', rule: 'eway', hint: '12 digits. Goods worth more than ₹50,000 need one' },
    { name: 'emptyWeight', label: 'Empty weight (kg)', type: 'number', validate: nonNegative('emptyWeight'), hint: 'Cannot be changed once the truck has left' },
    { name: 'loadedWeight', label: 'Loaded weight (kg)', type: 'number', validate: (f) => nonNegative('loadedWeight')(f) || weightProblem(f) },
    { name: 'photoLoaded', label: 'Photo – loaded truck', type: 'photo' },
    { name: 'photoCovered', label: 'Photo – covered truck', type: 'photo' },
    { name: 'documents', label: 'Papers (GST bill, e-way bill, rawanna)', type: 'photos', wide: true },
    { name: 'note', label: 'Note', type: 'textarea', wide: true },
  ];
  const inFields = [
    { name: 'date', label: 'Date', type: 'date', required: true, createOnly: true, validate: (f) => (f.date && f.date > todayISO() ? 'Date cannot be in the future' : '') },
    { name: 'kind', label: 'Coming with', type: 'select', options: ['Blocks', 'Purchase', 'Other'], required: true, default: 'Blocks' },
    { name: 'truckNo', label: 'Truck number', required: true, placeholder: 'RJ06 XX 0000', rule: 'truckNo' },
    { name: 'driverName', label: 'Driver name', rule: 'name' },
    { name: 'transporter', label: 'Transporter / source', rule: 'partyName' },
    { name: 'emptyWeight', label: 'Empty weight (kg)', type: 'number', validate: nonNegative('emptyWeight') },
    { name: 'loadedWeight', label: 'Loaded weight (kg)', type: 'number', validate: (f) => nonNegative('loadedWeight')(f) || weightProblem(f) },
    { name: 'note', label: 'Note', type: 'textarea', wide: true },
    { name: 'photoLoaded', label: 'Photo', type: 'photo' },
  ];

  const markOut = async (row, reload) => {
    if (!await confirmDialog(`Mark truck ${row.truckNo} OUT? Stock will be deducted.`)) return;
    try { await apiAsk(`/api/dispatches/${row._id}/out`); toast.success('Truck marked out ✔'); reload(); } catch (e) { if (!e.data?.cancelled) toast.error(e.message); }
  };
  const waMsg = (r) => `Dear ${r.customerName}, your order ${r.saleNo || ''} has left our ${session?.company?.name || 'Vipul Stone'} factory.\nTruck: ${r.truckNo}\nDriver: ${r.driverName || '-'} ${r.driverMobile || ''}\nInvoice: ${r.invoiceNo || '-'}\nE-way bill: ${r.eway || '-'}\n— ${session?.company?.name || 'Vipul Stone'}`;

  const payFreight = async (row, reload) => {
    const m = (await promptDialog(`Freight ${inr(row.freight)} to ${row.transporter || 'the transporter'}. Paid by: Cash / UPI / Bank`, 'Bank'));
    if (m === null) return;
    const lower = m.trim().toLowerCase();
    const mode = lower === 'cash' ? 'Cash' : lower === 'upi' ? 'UPI' : 'Bank';
    try { await api(`/api/dispatches/${row._id}/freight-paid`, { method: 'POST', body: { mode } }); toast.success('Freight marked paid'); reload(); } catch (e) { toast.error(e.message); }
  };

  const deleteTrip = async (trip) => {
    if (!await confirmDialog(`Delete trip record for ${trip.truckNo} (${trip.outDate})?`)) return;
    try {
      await api(`/api/truck-updates/${trip._id}`, { method: 'DELETE' });
      toast.success('Trip record deleted');
      reloadTrucks();
    } catch (e) {
      toast.error(e.message || 'Failed to delete trip');
    }
  };

  const outCols = [
    { key: 'gatePassNo', label: 'Gate pass', primary: true, render: (r) => <span>{r.gatePassNo}<div className="text-[11px] text-char-500 font-normal">{r.customerName}</div></span> },
    { key: 'truckNo', label: 'Truck', render: (r) => <span>{r.truckNo}<div className="text-[11px] text-char-500">{r.driverName}</div></span> },
    { key: 'items', label: 'Items', wide: true, render: (r) => (r.items || []).map((i) => `${i.name} × ${num(i.qty)}`).join(', ') },
    { key: 'netWeight', label: 'Net weight', render: (r) => (r.netWeight ? `${num(r.netWeight)} kg` : '—') },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'out' ? 'green' : 'amber'}>{r.status === 'out' ? 'Truck out' : 'Loading'}</Badge> },
  ];
  const outActions = (row, { reload }) => [
    row.status === 'loading' && canMark && { label: 'Mark out', tone: 'primary', icon: <LogOut size={14} />, onClick: () => markOut(row, reload) },
    { label: 'Gate pass', icon: <Printer size={14} />, onClick: () => window.open(`/dispatch/${row._id}`, '_blank') },
    row.status === 'out' && { label: '', icon: <MessageCircle size={14} />, onClick: () => openWA(waMsg(row), row.customerMobile) },
    row.freight > 0 && !row.freightPaid && can('cashentries', 'create') && { label: 'Freight paid', icon: <Banknote size={14} />, onClick: () => payFreight(row, reload) },
  ].filter(Boolean);

  const freight = fr.data?.rows || [];

  return (
    <RoleGuard perm="dispatches">
      {/* Navigation tabs */}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'trucks', label: 'Daily Truck Updates', count: trucksData.length },
          { key: 'logs', label: 'Trip History & Fuel Logs', count: tripsData.length },
          { key: 'out', label: 'Customer Loading Slips' },
          { key: 'in', label: 'Incoming Trucks' },
          { key: 'freight', label: 'Freight' },
        ]}
      />

      {/* TAB 1: DAILY TRUCK UPDATES */}
      {tab === 'trucks' && (
        <div className="space-y-4">
          {/* Header Action Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 border border-sand-300">
            <div>
              <h1 className="text-lg font-bold text-char flex items-center gap-2">
                <Truck className="text-terra" size={22} />
                <T>Daily Truck Updates</T>
              </h1>
              <p className="text-xs text-char-500 mt-0.5">
                <T>Monitor factory truck departures & arrivals with fuel in L, kilometers, driver, and trip duration</T>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={reloadTrucks}
                title={tr('Refresh truck list')}
              >
                <RefreshCw size={14} className={tuQ.loading ? 'animate-spin' : ''} />
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => setAddTruckOpen(true)}
              >
                <Plus size={16} /> <T>Add Truck</T>
              </button>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Total Trucks" value={stats.totalTrucks} />
            <StatCard label="In Factory" value={stats.inFactory} tone="green" />
            <StatCard label="On Trip (OUT)" value={stats.onTrip} tone="amber" />
            <StatCard label="Today Fuel Consumed" value={`${num(stats.todayFuel)} L`} tone={stats.todayFuel > 0 ? 'amber' : 'gray'} />
            <StatCard label="Today Distance" value={`${num(stats.todayKm)} km`} />
          </div>

          {/* Search & Filter Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 border border-sand-300">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search size={16} className="absolute left-3 top-2.5 text-char-400" />
              <input
                type="text"
                className="input pl-9"
                placeholder={tr('Search truck name, reg number, driver…')}
                value={truckSearch}
                onChange={(e) => setTruckSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                className={`px-3 py-1.5 border font-medium cursor-pointer transition select-none ${
                  statusFilter === 'all'
                    ? 'bg-terra text-white border-terra-600'
                    : 'bg-white text-char border-sand-300 hover:bg-sand-50'
                }`}
                onClick={() => setStatusFilter('all')}
              >
                <T>All</T> ({trucksData.length})
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 border font-medium cursor-pointer transition select-none ${
                  statusFilter === 'in'
                    ? 'bg-emerald-700 text-white border-emerald-800'
                    : 'bg-white text-char border-sand-300 hover:bg-sand-50'
                }`}
                onClick={() => setStatusFilter('in')}
              >
                <T>In Factory</T> ({stats.inFactory})
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 border font-medium cursor-pointer transition select-none ${
                  statusFilter === 'out'
                    ? 'bg-amber-700 text-white border-amber-800'
                    : 'bg-white text-char border-sand-300 hover:bg-sand-50'
                }`}
                onClick={() => setStatusFilter('out')}
              >
                <T>On Trip</T> ({stats.onTrip})
              </button>
            </div>
          </div>

          {/* Loading Skeleton */}
          {tuQ.loading && !trucksData.length && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-56 skeleton border border-sand-300" />
              ))}
            </div>
          )}

          {/* Empty Trucks State */}
          {!tuQ.loading && !trucksData.length && (
            <div className="p-10 bg-white border border-sand-300 text-center">
              <div className="w-16 h-16 mx-auto mb-3 flex items-center justify-center bg-sand-100 text-terra rounded-none">
                <Truck size={32} />
              </div>
              <h3 className="text-base font-bold text-char mb-1"><T>No Factory Trucks in Database</T></h3>
              <p className="text-xs text-char-500 max-w-sm mx-auto mb-4">
                <T>Add your factory trucks (like raw material trucks, tippers, tractors) to start tracking daily OUT & IN movements with fuel and kilometers.</T>
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setAddTruckOpen(true)}
              >
                <Plus size={16} /> <T>Add Factory Truck</T>
              </button>
            </div>
          )}

          {/* Trucks Grid */}
          {filteredTrucks.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTrucks.map((trk) => {
                const isOnTrip = trk.status === 'out';
                const active = trk.activeTrip;

                return (
                  <div
                    key={trk._id}
                    className={`bg-white border transition-all duration-150 flex flex-col justify-between ${
                      isOnTrip ? 'border-amber-400 shadow-sm' : 'border-sand-300 hover:border-sand-400'
                    }`}
                  >
                    {/* Card Top */}
                    <div className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-base text-char flex items-center gap-2">
                            <span>{trk.name}</span>
                          </div>
                          <div className="text-xs font-semibold text-char-600 mt-0.5">
                            {trk.regNo ? trk.regNo : <span className="text-char-400 italic">No reg number</span>}
                          </div>
                        </div>
                        <Badge tone={isOnTrip ? 'amber' : 'green'}>
                          {isOnTrip ? tr('On Trip (OUT)') : tr('In Factory')}
                        </Badge>
                      </div>

                      {/* Driver & Latest Readings */}
                      <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-sand-100">
                        <div>
                          <span className="text-char-500 block text-[11px]"><T>Driver</T></span>
                          <span className="font-medium text-char truncate block">
                            {isOnTrip ? active?.driverName : trk.lastDriverName || trk.driverName || '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-char-500 block text-[11px]"><T>Last Odometer</T></span>
                          <span className="font-medium text-char">
                            {trk.lastKm != null ? `${num(trk.lastKm)} km` : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-char-500 block text-[11px]"><T>Current Fuel in L</T></span>
                          <span className="font-medium text-char">
                            {trk.lastFuel != null ? `${num(trk.lastFuel)} L` : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-char-500 block text-[11px]"><T>Vehicle Type</T></span>
                          <span className="font-medium text-char">{trk.kind || 'Truck'}</span>
                        </div>
                      </div>

                      {/* Active Trip Info Box */}
                      {isOnTrip && active && (
                        <div className="p-2.5 bg-amber-50 border border-amber-200 text-xs space-y-1">
                          <div className="font-bold text-amber-900 flex items-center justify-between">
                            <span>Active Trip: {active.purpose}</span>
                            <span className="text-[11px] font-normal text-amber-700">{active.outDate} {active.outTime}</span>
                          </div>
                          <div className="text-amber-800 text-[11px] flex items-center gap-3">
                            <span>Start KM: <b>{num(active.outKm)}</b></span>
                            <span>Start Fuel: <b>{num(active.outFuel)} L</b></span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Card Actions: OUT and IN buttons */}
                    <div className="p-3 bg-sand-50/70 border-t border-sand-200 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className={`btn btn-sm ${
                          isOnTrip
                            ? 'opacity-40 cursor-not-allowed bg-white border border-sand-200 text-char-400'
                            : 'btn-outline border-amber-600 text-amber-800 hover:bg-amber-50 hover:border-amber-700'
                        }`}
                        disabled={isOnTrip}
                        title={isOnTrip ? tr('Truck is currently on a trip') : tr('Record truck leaving factory')}
                        onClick={() => setOutTruck(trk)}
                      >
                        <LogOut size={14} /> <T>Truck OUT</T>
                      </button>

                      <button
                        type="button"
                        className={`btn btn-sm ${
                          !isOnTrip
                            ? 'opacity-40 cursor-not-allowed bg-white border border-sand-200 text-char-400'
                            : 'btn-green shadow-none'
                        }`}
                        disabled={!isOnTrip}
                        title={!isOnTrip ? tr('Truck is already in factory') : tr('Record truck return & meters')}
                        onClick={() => setInTruck(trk)}
                      >
                        <LogIn size={14} /> <T>Truck IN</T>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: TRIP HISTORY & FUEL LOGS */}
      {tab === 'logs' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 border border-sand-300">
            <div>
              <h2 className="text-base font-bold text-char"><T>Trip History & Fuel Consumption Logs</T></h2>
              <p className="text-xs text-char-500 mt-0.5">
                <T>Detailed audit log of all truck trips, kilometers traveled, fuel consumed in L, driver, and departure/return timings</T>
              </p>
            </div>
            <button type="button" className="btn-outline btn-sm" onClick={reloadTrucks}>
              <RefreshCw size={14} className={tuQ.loading ? 'animate-spin' : ''} /> <T>Refresh</T>
            </button>
          </div>

          <div className="bg-white border border-sand-300 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="th"><T>Truck</T></th>
                  <th className="th"><T>Driver</T></th>
                  <th className="th"><T>Purpose</T></th>
                  <th className="th"><T>Departure (OUT)</T></th>
                  <th className="th"><T>Return (IN)</T></th>
                  <th className="th"><T>Kilometers</T></th>
                  <th className="th"><T>Fuel in L</T></th>
                  <th className="th"><T>Status</T></th>
                  <th className="th text-right"><T>Action</T></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand-200 text-sm">
                {!tripsData.length && (
                  <tr>
                    <td colSpan={9} className="td text-center py-8 text-char-400 italic">
                      <T>No trips recorded yet. Use the Daily Truck Updates tab to record truck OUT and IN.</T>
                    </td>
                  </tr>
                )}
                {tripsData.map((trp) => {
                  const isReturned = trp.status === 'in';
                  return (
                    <tr key={trp._id} className="hover:bg-sand-50/60 transition">
                      <td className="td font-semibold text-char">
                        {trp.truckNo}
                        {trp.vehicleName && trp.vehicleName !== trp.truckNo && (
                          <div className="text-[11px] font-normal text-char-500">{trp.vehicleName}</div>
                        )}
                      </td>
                      <td className="td">
                        <span className="font-medium">{trp.driverName}</span>
                        {trp.driverMobile && <div className="text-[11px] text-char-500">{trp.driverMobile}</div>}
                      </td>
                      <td className="td text-char-700">{trp.purpose}</td>
                      <td className="td whitespace-nowrap text-xs">
                        <div className="font-medium text-char">{trp.outDate} {trp.outTime}</div>
                        <div className="text-char-500">{num(trp.outKm)} km · {num(trp.outFuel)} L</div>
                      </td>
                      <td className="td whitespace-nowrap text-xs">
                        {isReturned ? (
                          <>
                            <div className="font-medium text-char">{trp.inDate} {trp.inTime}</div>
                            <div className="text-char-500">{num(trp.inKm)} km · {num(trp.inFuel)} L</div>
                          </>
                        ) : (
                          <span className="text-amber-700 italic">Currently on trip…</span>
                        )}
                      </td>
                      <td className="td text-xs">
                        {isReturned && trp.kmTraveled != null ? (
                          <>
                            <span className="font-bold text-char text-sm">{num(trp.kmTraveled)} km</span>
                            <div className="text-[11px] text-char-500">{num(trp.outKm)} → {num(trp.inKm)}</div>
                          </>
                        ) : (
                          <span className="text-char-400">—</span>
                        )}
                      </td>
                      <td className="td text-xs">
                        {isReturned && trp.fuelConsumed != null ? (
                          <>
                            <span className="font-bold text-amber-800 text-sm">{num(trp.fuelConsumed)} L</span>
                            <div className="text-[11px] text-char-500">
                              {num(trp.outFuel)}L {trp.fuelAdded > 0 ? `+${num(trp.fuelAdded)}L` : ''} → {num(trp.inFuel)}L
                            </div>
                          </>
                        ) : (
                          <span className="text-char-400">—</span>
                        )}
                      </td>
                      <td className="td">
                        <Badge tone={isReturned ? 'green' : 'amber'}>
                          {isReturned ? tr('Returned') : tr('On Trip')}
                        </Badge>
                      </td>
                      <td className="td text-right">
                        <button
                          type="button"
                          className="p-1 rounded-none text-char-400 hover:text-red-600 transition"
                          title={tr('Delete trip')}
                          onClick={() => deleteTrip(trp)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CUSTOMER LOADING SLIPS (SALES DISPATCH) */}
      {tab === 'out' && (
        <CrudPage
          key={'o' + reloadKey}
          model="dispatches"
          baseQuery={{ direction: 'out' }}
          canAdd={false}
          headerExtra={
            <>
              {can('dispatches', 'create') && (
                <button className="btn-primary" onClick={() => setLoadOpen(true)}>
                  <Plus size={18} />
                  <T> New loading slip</T>
                </button>
              )}
              <ImportData resource="dispatch-out" perm="dispatches" noun="loading slips" hint="order, truck, item and quantity are required" />
            </>
          }
          title="Customer Loading Slips & Gate Passes"
          subtitle="Orders loaded at the factory gate with invoice and gate pass"
          label="Loading slip"
          wide
          fields={outFields}
          columns={outCols}
          sort="-date,-createdAt"
          canEdit={() => true}
          filters={[{ key: 'status', label: 'All status', options: [{ value: 'loading', label: 'Loading' }, { value: 'out', label: 'Truck out' }] }]}
          facets={{ by: 'status', query: { direction: 'out', from: todayISO() } }}
          summary={(rows, { facets: f }) => (
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Out today" value={f?.groups?.out?.n ?? 0} tone="green" />
              <StatCard label="Loading today" value={f?.groups?.loading?.n ?? 0} tone="amber" />
              <StatCard label="Trucks today" value={f?.total ?? 0} />
            </div>
          )}
          rowActions={outActions}
          exportName="dispatches"
          exportColumns={[
            { key: 'gatePassNo', label: 'Gate pass' },
            { key: 'date', label: 'Date' },
            { key: 'customerName', label: 'Customer' },
            { key: 'truckNo', label: 'Truck' },
            { key: 'driverName', label: 'Driver' },
            { key: 'netWeight', label: 'Net weight kg' },
            { key: 'freight', label: 'Freight' },
            { key: 'status', label: 'Status' },
          ]}
        />
      )}

      {/* TAB 4: INCOMING TRUCKS */}
      {tab === 'in' && (
        <CrudPage
          model="dispatches"
          baseQuery={{ direction: 'in' }}
          headerExtra={<ImportData resource="dispatch-in" perm="dispatches" noun="incoming trucks" />}
          title="Incoming trucks"
          subtitle="Blocks and purchases entered at the gate"
          label="Incoming truck"
          addLabel="Truck in"
          fields={inFields}
          defaults={{ direction: 'in' }}
          sort="-date,-createdAt"
          columns={[
            { key: 'truckNo', label: 'Truck', primary: true },
            { key: 'kind', label: 'Brought', render: (r) => r.kind || '—' },
            { key: 'driverName', label: 'Driver' },
            { key: 'netWeight', label: 'Net weight', render: (r) => (r.netWeight ? `${num(r.netWeight)} kg` : '—') },
            { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
            { key: 'note', label: 'Note', wide: true },
          ]}
        />
      )}

      {/* TAB 5: FREIGHT */}
      {tab === 'freight' && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <StatCard label="Freight pending" value={inr(sum(freight, 'pending'))} tone="amber" />
            <StatCard label="Freight paid" value={inr(sum(freight, 'paid'))} tone="green" />
          </div>
          <DataList
            loading={fr.loading}
            rows={freight}
            rowKey="name"
            empty="No freight entered"
            columns={[
              { key: 'name', label: 'Transporter', primary: true },
              { key: 'trips', label: 'Trips' },
              { key: 'total', label: 'Total', render: (r) => inr(r.total) },
              { key: 'paid', label: 'Paid', render: (r) => inr(r.paid) },
              { key: 'pending', label: 'Pending', render: (r) => <b className={r.pending ? 'text-amber-700' : ''}>{inr(r.pending)}</b> },
            ]}
            actions={(r) =>
              r.pending > 0 &&
              can('cashentries', 'create') && (
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={async () => {
                    const m = await promptDialog(`Mark ${inr(r.pending)} freight as paid to ${r.name}. Paid by: Cash / UPI / Bank`, 'Bank');
                    if (m === null) return;
                    const l = m.trim().toLowerCase();
                    const mode = l === 'cash' ? 'Cash' : l === 'upi' ? 'UPI' : 'Bank';
                    try {
                      await api('/api/bulk/freight-paid', { method: 'POST', body: { ...(r.transporter ? { transporter: r.transporter } : {}), mode } });
                      toast.success('Marked paid');
                      fr.reload();
                    } catch (e) {
                      toast.error(e.message);
                    }
                  }}
                >
                  <T>Mark paid</T>
                </button>
              )
            }
          />
        </div>
      )}

      {/* Dialogs */}
      <TruckOutModal
        open={Boolean(outTruck)}
        onClose={() => setOutTruck(null)}
        truck={outTruck}
        onDone={reloadTrucks}
      />

      <TruckInModal
        open={Boolean(inTruck)}
        onClose={() => setInTruck(null)}
        truck={inTruck}
        onDone={reloadTrucks}
      />

      <AddTruckModal
        open={addTruckOpen}
        onClose={() => setAddTruckOpen(false)}
        onDone={reloadTrucks}
      />

      <LoadingSheet
        open={loadOpen}
        onClose={() => setLoadOpen(false)}
        onDone={() => setReloadKey((k) => k + 1)}
      />
    </RoleGuard>
  );
}
