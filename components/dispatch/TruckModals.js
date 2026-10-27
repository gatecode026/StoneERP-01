'use client';
import { useState, useEffect } from 'react';
import toast from '@/lib/toast';
import { Sheet, Field } from '@/components/ui';
import LookupSelect from '@/components/LookupSelect';
import { api } from '@/lib/client';
import { todayISO, num } from '@/lib/format';
import T from '@/components/T';
import { LogOut, LogIn, Plus, Truck, Clock } from 'lucide-react';

const PURPOSES = ['Raw Material', 'Stone Blocks', 'Customer Delivery', 'Factory Supplies', 'Service / Repair', 'Other'];

export function TruckOutModal({ open, onClose, truck, onDone }) {
  const [f, setF] = useState({
    driverName: '',
    driverCode: '',
    driverMobile: '',
    purpose: 'Raw Material',
    outKm: '',
    outFuel: '',
    outDate: todayISO(),
    outTime: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && truck) {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      setF({
        driverName: truck.lastDriverName || truck.driverName || '',
        driverCode: truck.driverCode || '',
        driverMobile: '',
        purpose: 'Raw Material',
        outKm: truck.lastKm != null ? String(truck.lastKm) : '',
        outFuel: truck.lastFuel != null ? String(truck.lastFuel) : '',
        outDate: todayISO(),
        outTime: timeStr,
        notes: '',
      });
    }
  }, [open, truck]);

  if (!truck) return null;

  async function handleSave() {
    if (!f.driverName?.trim()) {
      toast.error('Driver name is required');
      return;
    }
    if (f.outKm === '' || isNaN(Number(f.outKm)) || Number(f.outKm) < 0) {
      toast.error('Enter valid Current Odometer (KM)');
      return;
    }
    if (f.outFuel === '' || isNaN(Number(f.outFuel)) || Number(f.outFuel) < 0) {
      toast.error('Enter valid Current Fuel in L');
      return;
    }

    setBusy(true);
    try {
      await api('/api/truck-updates', {
        method: 'POST',
        body: {
          vehicleId: truck._id,
          truckNo: truck.regNo || truck.name,
          driverName: f.driverName,
          driverCode: f.driverCode,
          driverMobile: f.driverMobile,
          purpose: f.purpose,
          outKm: Number(f.outKm),
          outFuel: Number(f.outFuel),
          outDate: f.outDate,
          outTime: f.outTime,
          notes: f.notes,
        },
      });
      toast.success(`Truck ${truck.name} is marked OUT on trip`);
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(e.message || 'Failed to record truck OUT');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Truck OUT · ${truck.name}${truck.regNo ? ` (${truck.regNo})` : ''}`}
      footer={
        <>
          <button type="button" className="btn-outline flex-1 sm:flex-initial sm:min-w-[100px]" onClick={onClose}>
            <T>Cancel</T>
          </button>
          <button
            type="button"
            className="btn-primary flex-1 sm:flex-initial sm:min-w-[160px]"
            disabled={busy}
            onClick={handleSave}
          >
            <LogOut size={16} /> <T>Confirm Truck OUT</T>
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Truck identity card */}
        <div className="flex items-center gap-3 p-3 bg-amber-50/60 border border-amber-200">
          <div className="w-10 h-10 flex items-center justify-center bg-amber-100 text-amber-800">
            <Truck size={20} />
          </div>
          <div>
            <div className="font-bold text-sm text-char">{truck.name}</div>
            <div className="text-xs text-char-600">
              {truck.regNo ? `Reg: ${truck.regNo}` : 'Factory Truck'}
              {truck.lastKm != null && ` · Last reading: ${num(truck.lastKm)} km`}
              {truck.lastFuel != null && ` · Last fuel: ${num(truck.lastFuel)} L`}
            </div>
          </div>
        </div>

        {/* Driver selection */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <Field label="Driver Name" required hint="Search employee or enter name">
            <LookupSelect
              kind="employees"
              valueLabel={f.driverName}
              placeholder="Select or type driver name…"
              onChange={(it) => {
                if (it) {
                  setF((prev) => ({ ...prev, driverName: it.label?.split(' (')[0] || it.label, driverCode: it.hint || '' }));
                }
              }}
            />
          </Field>
          <Field label="Driver Mobile" hint="Optional contact number">
            <input
              type="tel"
              className="input"
              placeholder="e.g. 98290XXXXX"
              value={f.driverMobile}
              onChange={(e) => setF({ ...f, driverMobile: e.target.value })}
            />
          </Field>
        </div>

        {/* Meters: Fuel and KM */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <Field label="Current Fuel in L" required hint="Fuel in tank before departure">
            <div className="relative">
              <input
                type="number"
                step="any"
                min="0"
                className="input font-semibold pr-12"
                placeholder="e.g. 50"
                value={f.outFuel}
                onChange={(e) => setF({ ...f, outFuel: e.target.value })}
              />
              <span className="absolute right-3 top-2 text-xs font-semibold text-char-500">L</span>
            </div>
          </Field>
          <Field label="Current Odometer (KM)" required hint="Speedometer / odometer reading">
            <div className="relative">
              <input
                type="number"
                step="any"
                min="0"
                className="input font-semibold pr-14"
                placeholder="e.g. 15400"
                value={f.outKm}
                onChange={(e) => setF({ ...f, outKm: e.target.value })}
              />
              <span className="absolute right-3 top-2 text-xs font-semibold text-char-500">KM</span>
            </div>
          </Field>
        </div>

        {/* Purpose */}
        <Field label="Purpose of Trip" required>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PURPOSES.map((p) => (
              <button
                key={p}
                type="button"
                className={`px-2.5 py-1 text-xs border cursor-pointer select-none transition ${
                  f.purpose === p
                    ? 'bg-terra text-white border-terra-600 font-semibold'
                    : 'bg-white text-char border-sand-300 hover:bg-sand-50'
                }`}
                onClick={() => setF({ ...f, purpose: p })}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            type="text"
            className="input"
            placeholder="Trip reason / destination"
            value={f.purpose}
            onChange={(e) => setF({ ...f, purpose: e.target.value })}
          />
        </Field>

        {/* Timing */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <Field label="Departure Date" required>
            <input
              type="date"
              className="input"
              value={f.outDate}
              onChange={(e) => setF({ ...f, outDate: e.target.value })}
            />
          </Field>
          <Field label="Departure Time" required>
            <input
              type="time"
              className="input"
              value={f.outTime}
              onChange={(e) => setF({ ...f, outTime: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Notes / Remarks" hint="Optional details (destination, cargo, rawanna)">
          <textarea
            className="input"
            rows={2}
            placeholder="Add any specific trip notes…"
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </Field>
      </div>
    </Sheet>
  );
}

export function TruckInModal({ open, onClose, truck, onDone }) {
  const trip = truck?.activeTrip;
  const [f, setF] = useState({
    inKm: '',
    inFuel: '',
    fuelAdded: '0',
    inDate: todayISO(),
    inTime: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && trip) {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      setF({
        inKm: '',
        inFuel: '',
        fuelAdded: '0',
        inDate: todayISO(),
        inTime: timeStr,
        notes: '',
      });
    }
  }, [open, trip]);

  if (!truck || !trip) return null;

  const inKmNum = Number(f.inKm);
  const outKmNum = Number(trip.outKm) || 0;
  const outFuelNum = Number(trip.outFuel) || 0;
  const inFuelNum = Number(f.inFuel);
  const fuelAddedNum = Number(f.fuelAdded) || 0;

  const validKm = f.inKm !== '' && !isNaN(inKmNum) && inKmNum >= outKmNum;
  const kmTraveled = validKm ? Math.round((inKmNum - outKmNum) * 100) / 100 : 0;

  const validFuel = f.inFuel !== '' && !isNaN(inFuelNum) && inFuelNum >= 0;
  const fuelConsumed = validFuel
    ? Math.max(0, Math.round(((outFuelNum + fuelAddedNum) - inFuelNum) * 100) / 100)
    : 0;

  const efficiency = validKm && validFuel && fuelConsumed > 0 ? (kmTraveled / fuelConsumed).toFixed(2) : null;

  async function handleSave() {
    if (f.inKm === '' || isNaN(inKmNum) || inKmNum < 0) {
      toast.error('Enter valid Return Odometer (KM)');
      return;
    }
    if (inKmNum < outKmNum) {
      toast.error(`Return KM (${inKmNum}) cannot be less than Start KM (${outKmNum})`);
      return;
    }
    if (f.inFuel === '' || isNaN(inFuelNum) || inFuelNum < 0) {
      toast.error('Enter valid Return Fuel in L');
      return;
    }

    setBusy(true);
    try {
      await api(`/api/truck-updates/${trip._id}`, {
        method: 'PATCH',
        body: {
          inKm: inKmNum,
          inFuel: inFuelNum,
          fuelAdded: fuelAddedNum,
          inDate: f.inDate,
          inTime: f.inTime,
          notes: f.notes,
        },
      });
      toast.success(
        `Truck ${truck.name} is marked IN ✔ (Distance: ${num(kmTraveled)} km, Consumed: ${num(fuelConsumed)} L fuel)`
      );
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(e.message || 'Failed to record truck IN');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Truck IN · ${truck.name}${truck.regNo ? ` (${truck.regNo})` : ''}`}
      footer={
        <>
          <button type="button" className="btn-outline flex-1 sm:flex-initial sm:min-w-[100px]" onClick={onClose}>
            <T>Cancel</T>
          </button>
          <button
            type="button"
            className="btn-green flex-1 sm:flex-initial sm:min-w-[180px]"
            disabled={busy}
            onClick={handleSave}
          >
            <LogIn size={16} /> <T>Confirm Truck IN</T>
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Out Details Banner */}
        <div className="p-3.5 bg-sand-100/70 border border-sand-300">
          <div className="text-xs font-bold uppercase text-char-600 mb-1.5 flex items-center gap-1.5">
            <Clock size={14} className="text-terra" /> Trip Departure Details
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <span className="text-char-500 block">Departed:</span>
              <span className="font-semibold text-char">{trip.outDate} {trip.outTime}</span>
            </div>
            <div>
              <span className="text-char-500 block">Driver:</span>
              <span className="font-semibold text-char">{trip.driverName}</span>
            </div>
            <div>
              <span className="text-char-500 block">Start KM:</span>
              <span className="font-semibold text-char">{num(trip.outKm)} km</span>
            </div>
            <div>
              <span className="text-char-500 block">Start Fuel in L:</span>
              <span className="font-semibold text-char">{num(trip.outFuel)} L</span>
            </div>
          </div>
          <div className="mt-2 text-xs text-char-600">
            <span className="text-char-500">Purpose: </span>
            <span className="font-medium text-char">{trip.purpose}</span>
          </div>
        </div>

        {/* Return Meters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <Field
            label="Return Odometer (KM)"
            required
            hint={`Must be ≥ start reading (${num(trip.outKm)} km)`}
            error={f.inKm !== '' && inKmNum < outKmNum ? `Cannot be less than ${num(trip.outKm)} km` : ''}
          >
            <div className="relative">
              <input
                type="number"
                step="any"
                min={outKmNum}
                className={`input font-semibold pr-14 ${f.inKm !== '' && inKmNum < outKmNum ? '!border-red-500' : ''}`}
                placeholder={`e.g. ${outKmNum + 50}`}
                value={f.inKm}
                onChange={(e) => setF({ ...f, inKm: e.target.value })}
              />
              <span className="absolute right-3 top-2 text-xs font-semibold text-char-500">KM</span>
            </div>
          </Field>

          <Field label="Return Fuel in L" required hint="Fuel remaining in tank upon return">
            <div className="relative">
              <input
                type="number"
                step="any"
                min="0"
                className="input font-semibold pr-12"
                placeholder="e.g. 35"
                value={f.inFuel}
                onChange={(e) => setF({ ...f, inFuel: e.target.value })}
              />
              <span className="absolute right-3 top-2 text-xs font-semibold text-char-500">L</span>
            </div>
          </Field>
        </div>

        {/* Refueled during trip */}
        <Field label="Fuel Added / Refueled during trip (L)" hint="If any fuel was filled up during the trip, enter litres here (default 0)">
          <div className="relative max-w-xs">
            <input
              type="number"
              step="any"
              min="0"
              className="input pr-12"
              placeholder="0"
              value={f.fuelAdded}
              onChange={(e) => setF({ ...f, fuelAdded: e.target.value })}
            />
            <span className="absolute right-3 top-2 text-xs font-semibold text-char-500">L</span>
          </div>
        </Field>

        {/* Live Trip Calculation Card */}
        {validKm && validFuel && (
          <div className="p-3 bg-emerald-50/70 border border-emerald-300">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-800 mb-2">Trip Consumption Calculation</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-2 bg-white border border-emerald-200">
                <div className="text-char-500 text-[11px]">Distance Traveled</div>
                <div className="text-base font-bold text-char">{num(kmTraveled)} km</div>
                <div className="text-[10px] text-char-400">{num(inKmNum)} - {num(outKmNum)}</div>
              </div>
              <div className="p-2 bg-white border border-emerald-200">
                <div className="text-char-500 text-[11px]">Fuel Consumed</div>
                <div className="text-base font-bold text-char">{num(fuelConsumed)} L</div>
                <div className="text-[10px] text-char-400">({num(outFuelNum)} + {num(fuelAddedNum)}) - {num(inFuelNum)}</div>
              </div>
              {efficiency && (
                <div className="p-2 bg-white border border-emerald-200 col-span-2 sm:col-span-1">
                  <div className="text-char-500 text-[11px]">Efficiency</div>
                  <div className="text-base font-bold text-emerald-700">{efficiency} km/L</div>
                  <div className="text-[10px] text-char-400">Average mileage</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Timing */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <Field label="Return Date" required>
            <input
              type="date"
              className="input"
              value={f.inDate}
              onChange={(e) => setF({ ...f, inDate: e.target.value })}
            />
          </Field>
          <Field label="Return Time" required>
            <input
              type="time"
              className="input"
              value={f.inTime}
              onChange={(e) => setF({ ...f, inTime: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Return Notes / Unloading Remark" hint="Optional notes">
          <textarea
            className="input"
            rows={2}
            placeholder="Add any notes about returned goods, weight, or vehicle condition…"
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </Field>
      </div>
    </Sheet>
  );
}

export function AddTruckModal({ open, onClose, onDone }) {
  const [f, setF] = useState({
    name: '',
    regNo: '',
    driverName: '',
    driverCode: '',
    initialKm: '',
    initialFuel: '',
  });
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!f.name.trim()) {
      toast.error('Truck name is required');
      return;
    }

    setBusy(true);
    try {
      await api('/api/truck-updates', {
        method: 'POST',
        body: {
          action: 'add_truck',
          name: f.name.trim(),
          regNo: f.regNo.trim().toUpperCase(),
          driverName: f.driverName.trim(),
          driverCode: f.driverCode.trim(),
          initialKm: Number(f.initialKm) || 0,
          initialFuel: Number(f.initialFuel) || 0,
        },
      });
      toast.success(`Truck "${f.name}" added successfully`);
      setF({ name: '', regNo: '', driverName: '', driverCode: '', initialKm: '', initialFuel: '' });
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(e.message || 'Failed to add truck');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add Factory Truck"
      footer={
        <>
          <button type="button" className="btn-outline flex-1 sm:flex-initial sm:min-w-[100px]" onClick={onClose}>
            <T>Cancel</T>
          </button>
          <button
            type="button"
            className="btn-primary flex-1 sm:flex-initial sm:min-w-[140px]"
            disabled={busy}
            onClick={handleSave}
          >
            <Plus size={16} /> <T>Save Truck</T>
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Truck Name / ID" required hint="e.g. Truck 1, Eicher 14ft, Tata Prima">
          <input
            type="text"
            className="input"
            placeholder="e.g. Truck 1"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>

        <Field label="Registration Number" hint="e.g. RJ06 GA 4521">
          <input
            type="text"
            className="input uppercase"
            placeholder="RJ06 GA 4521"
            value={f.regNo}
            onChange={(e) => setF({ ...f, regNo: e.target.value })}
          />
        </Field>

        <Field label="Assigned Driver" hint="Optional regular driver">
          <LookupSelect
            kind="employees"
            valueLabel={f.driverName}
            placeholder="Select driver…"
            onChange={(it) => {
              if (it) {
                setF((prev) => ({ ...prev, driverName: it.label?.split(' (')[0] || it.label, driverCode: it.hint || '' }));
              }
            }}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <Field label="Initial Odometer (KM)" hint="Current meter reading">
            <input
              type="number"
              step="any"
              min="0"
              className="input"
              placeholder="0"
              value={f.initialKm}
              onChange={(e) => setF({ ...f, initialKm: e.target.value })}
            />
          </Field>
          <Field label="Initial Fuel in L" hint="Current fuel level">
            <input
              type="number"
              step="any"
              min="0"
              className="input"
              placeholder="0"
              value={f.initialFuel}
              onChange={(e) => setF({ ...f, initialFuel: e.target.value })}
            />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
