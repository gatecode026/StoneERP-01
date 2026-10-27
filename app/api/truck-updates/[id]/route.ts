import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api/withAuth';
import { Vehicle, TruckTrip } from '@/lib/models';
import { badRequest, notFound } from '@/lib/errors';
import { todayIST, timeIST } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const PATCH = withAuth('dispatches', 'create', async (auth) => {
  const { id } = auth.params;
  const body = (await auth.json(z.record(z.string(), z.any()))) as any;
  const today = todayIST();
  const currentTime = timeIST();

  const trip = await TruckTrip.findOne({ _id: id, isVoid: false });
  if (!trip) throw notFound('Trip not found');
  if (trip.status === 'in') throw badRequest('Truck has already returned and been marked IN');

  const inKm = Number(body.inKm);
  const inFuel = Number(body.inFuel);
  const fuelAdded = Number(body.fuelAdded) || 0;

  if (isNaN(inKm) || inKm < 0) throw badRequest('Return KM must be a valid number >= 0');
  if (inKm < trip.outKm) throw badRequest(`Return KM (${inKm}) cannot be less than Start KM (${trip.outKm})`);
  if (isNaN(inFuel) || inFuel < 0) throw badRequest('Return Fuel in L must be a valid number >= 0');
  if (fuelAdded < 0) throw badRequest('Fuel added cannot be negative');

  const kmTraveled = Math.round((inKm - trip.outKm) * 100) / 100;
  // Fuel consumed = (starting fuel + refueled) - remaining fuel
  const fuelConsumed = Math.max(0, Math.round(((trip.outFuel + fuelAdded) - inFuel) * 100) / 100);

  const updatedTrip = await TruckTrip.findByIdAndUpdate(
    id,
    {
      $set: {
        status: 'in',
        inDate: body.inDate || today,
        inTime: body.inTime || currentTime,
        inKm,
        inFuel,
        fuelAdded,
        kmTraveled,
        fuelConsumed,
        ...(body.notes ? { notes: trip.notes ? `${trip.notes} | ${body.notes}` : body.notes } : {}),
      },
    },
    { new: true }
  );

  // Update vehicle back to in-factory
  await Vehicle.updateOne(
    { _id: trip.vehicleId },
    {
      $set: {
        status: 'in',
        currentTripId: null,
        lastKm: inKm,
        lastFuel: inFuel,
      },
    }
  );

  return NextResponse.json({ ok: true, trip: updatedTrip });
});

export const DELETE = withAuth('dispatches', 'edit', async (auth) => {
  const { id } = auth.params;
  const trip = await TruckTrip.findOne({ _id: id, isVoid: false });
  if (!trip) throw notFound('Trip not found');

  if (trip.status === 'out') {
    await Vehicle.updateOne(
      { _id: trip.vehicleId, currentTripId: trip._id },
      { $set: { status: 'in', currentTripId: null } }
    );
  }

  await TruckTrip.updateOne({ _id: id }, { $set: { isVoid: true } });
  return NextResponse.json({ ok: true });
});
