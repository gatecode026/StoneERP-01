/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { Vehicle, TruckTrip } from '@/lib/models';
import { badRequest } from '@/lib/errors';
import { todayIST, timeIST } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const GET = withAuth('dispatches', 'view', async () => {
  const today = todayIST();

  // Fetch all vehicles (factory trucks)
  const trucks: any[] = await Vehicle.find({
    isVoid: false,
    $or: [{ kind: 'Truck' }, { kind: { $exists: false } }],
  }).sort({ name: 1 }).lean();

  // For any truck marked 'out', fetch active trip details
  const activeTripIds = trucks.filter((t) => t.status === 'out' && t.currentTripId).map((t) => t.currentTripId);
  const activeTrips: any[] = activeTripIds.length
    ? await TruckTrip.find({ _id: { $in: activeTripIds }, isVoid: false }).lean()
    : [];
  const activeTripMap = new Map(activeTrips.map((tr) => [String(tr._id), tr]));

  const trucksWithActive = trucks.map((t) => ({
    ...t,
    activeTrip: t.currentTripId ? activeTripMap.get(String(t.currentTripId)) || null : null,
  }));

  // Fetch recent trips
  const trips: any[] = await TruckTrip.find({ isVoid: false })
    .sort({ outDate: -1, _id: -1 })
    .limit(100)
    .lean();

  // Compute stats
  const inFactory = trucks.filter((t) => t.status !== 'out').length;
  const onTrip = trucks.filter((t) => t.status === 'out').length;
  const todayTripsList = trips.filter((t) => t.outDate === today);
  const todayTrips = todayTripsList.length;
  const todayKm = todayTripsList.reduce((acc, t) => acc + (t.kmTraveled || 0), 0);
  const todayFuel = Math.round(todayTripsList.reduce((acc, t) => acc + (t.fuelConsumed || 0), 0) * 100) / 100;

  return {
    trucks: trucksWithActive,
    trips,
    stats: {
      totalTrucks: trucks.length,
      inFactory,
      onTrip,
      todayTrips,
      todayKm,
      todayFuel,
    },
  };
});

export const POST = withAuth('dispatches', 'create', async (auth) => {
  const body = (await auth.json(z.record(z.string(), z.any()))) as any;
  const today = todayIST();
  const currentTime = timeIST();

  // Quick add truck
  if (body.action === 'add_truck') {
    if (!body.name?.trim()) throw badRequest('Truck name or number is required');
    const existing = body.regNo?.trim()
      ? await Vehicle.findOne({ regNo: body.regNo.trim().toUpperCase(), isVoid: false })
      : null;
    if (existing) throw badRequest(`Vehicle with registration ${body.regNo} already exists`);

    const vehicle = await Vehicle.create({
      name: body.name.trim(),
      regNo: (body.regNo || '').trim().toUpperCase(),
      kind: 'Truck',
      driverName: (body.driverName || '').trim(),
      driverCode: (body.driverCode || '').trim().toUpperCase(),
      status: 'in',
      lastKm: Number(body.initialKm) || 0,
      lastFuel: Number(body.initialFuel) || 0,
      isVoid: false,
    });
    return NextResponse.json({ ok: true, vehicle });
  }

  // Record Truck OUT
  const { vehicleId, truckNo, driverName, driverCode, driverMobile, purpose, outKm, outFuel, outDate, outTime, notes } = body;
  if (!vehicleId) throw badRequest('Select a truck');
  if (!driverName?.trim()) throw badRequest('Driver name is required');
  if (outKm == null || isNaN(Number(outKm)) || Number(outKm) < 0) throw badRequest('Starting KM must be a valid number >= 0');
  if (outFuel == null || isNaN(Number(outFuel)) || Number(outFuel) < 0) throw badRequest('Starting Fuel in L must be a valid number >= 0');

  const vehicle = await Vehicle.findOne({ _id: vehicleId, isVoid: false });
  if (!vehicle) throw badRequest('Truck not found');
  if (vehicle.status === 'out') throw badRequest(`${vehicle.name} is already marked OUT on an active trip`);

  const trip = await TruckTrip.create({
    vehicleId,
    truckNo: truckNo || vehicle.regNo || vehicle.name,
    vehicleName: vehicle.name,
    driverCode: driverCode || vehicle.driverCode || '',
    driverName: driverName.trim(),
    driverMobile: driverMobile || '',
    purpose: purpose?.trim() || 'Raw Material',
    outDate: outDate || today,
    outTime: outTime || currentTime,
    outKm: Number(outKm),
    outFuel: Number(outFuel),
    status: 'out',
    notes: notes?.trim() || '',
    isVoid: false,
  });

  await Vehicle.updateOne(
    { _id: vehicleId },
    {
      $set: {
        status: 'out',
        currentTripId: trip._id,
        lastKm: Number(outKm),
        lastFuel: Number(outFuel),
        lastDriverName: driverName.trim(),
        lastOutTime: outTime || currentTime,
      },
    }
  );

  return NextResponse.json({ ok: true, trip });
});
