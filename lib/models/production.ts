import { defineModel, liveUnique, dateStr, monthStr, money, S, N, B, OID } from './_base';

export const MACHINE_TYPES = [
  'Calibration', 'Bridge Cutter', 'CNC', 'Pillar Machine', 'Edge Cutting',
  'Polish Machine', 'Tumble Machine', 'Bull Nose Machine', 'Cobble Machine',
  'Shot Blast', 'Block Cutter', 'Multi Machine', 'Wireshow',
  'Gang saw', 'Block cutter', 'Multi-cutter', 'Edge cutter', 'Calibration', 'Polishing', 'Flaming', 'Loader', 'Crane',
] as const;
export const CUTTING_TYPES = ['Bridge Cutter', 'Block Cutter', 'Multi Machine', 'CNC', 'Wireshow', 'Gang saw', 'Block cutter', 'Multi-cutter'] as const;

export const Machine = defineModel(
  'Machine',
  {
    name: { type: S, required: true, trim: true, maxlength: 80 },
    type: { type: S, required: true, trim: true, maxlength: 80 },
    location: { type: S, default: 'Factory' },
    purchaseDate: dateStr(),
    serviceIntervalDays: { type: N, min: 1, default: 90 },
    serviceIntervalHours: { type: N, min: 1 }, // service by running hours (PDF Part 13)
    lastServiceDate: dateStr(),
    lastServiceHourMeter: { type: N, min: 0 },
    hourMeter: { type: N, min: 0, default: 0 }, // latest reading
    supervisorCode: { type: S, uppercase: true, index: true },
    mechanicCodes: { type: [S], default: [] },
  },
  { indexes: [[{ name: 1 }, liveUnique()], [{ mechanicCodes: 1 }]] }
);

export const MachineEntry = defineModel(
  'MachineEntry',
  {
    date: dateStr({ required: true }),
    shift: { type: S, enum: ['Day', 'Night'], required: true },
    machineId: { type: OID, required: true },
    machineName: S,
    machineType: S,
    operatorCode: { type: S, required: true, uppercase: true },
    operatorName: S,
    startTime: { type: S, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    stopTime: { type: S, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    hourMeterStart: { type: N, min: 0 },
    hourMeterEnd: { type: N, min: 0 },
    hoursRun: { type: N, min: 0 },
    workDone: { type: S, maxlength: 500 },
    outputSqft: { type: N, min: 0, default: 0 },
    pieces: { type: N, min: 0 },
    blockNo: { type: N, min: 1 },
    wasteSqft: { type: N, min: 0, default: 0 },
    wasteReason: { type: S, maxlength: 300 },
    stockItemId: { type: OID },
    stoppedMins: { type: N, min: 0, default: 0 },
    stopReason: { type: S, maxlength: 300 },
    breakdown: { type: B, default: false },
    bladeChanged: { type: B, default: false },
    bladeCost: money(),
    electricityUnits: { type: N, min: 0 },
    electricityReadingStart: { type: N, min: 0 },
    electricityReadingEnd: { type: N, min: 0 },
    dieselLitres: { type: N, min: 0 },
    photo: S,
    remarks: { type: S, maxlength: 1000 },
    repairId: { type: OID },
  },
  {
    indexes: [
      [{ date: 1, shift: 1, machineId: 1 }, liveUnique()],
      [{ machineId: 1, date: -1 }],
      [{ blockNo: 1 }, { partialFilterExpression: { blockNo: { $gt: 0 } } }],
      [{ operatorCode: 1, date: -1 }],
      [{ date: -1 }],
    ],
  }
);

export const Block = defineModel(
  'Block',
  {
    blockNo: { type: N, required: true, min: 1 },
    date: dateStr({ required: true }),
    source: { type: S, enum: ['own', 'supplier'], default: 'own' },
    supplierId: { type: OID },
    supplierName: S,
    truckNo: { type: S, maxlength: 20, uppercase: true },
    rawanna: { type: S, required: true, trim: true, uppercase: true, maxlength: 60 }, // normalised: trimmed + upper case
    rawannaPhoto: S,
    length: { type: N, required: true, min: 0.01 },
    width: { type: N, required: true, min: 0.01 },
    height: { type: N, required: true, min: 0.01 },
    cft: { type: N, min: 0 },
    weight: { type: N, min: 0 },
    grade: { type: S, enum: ['A', 'B', 'C'], default: 'A' },
    photo: S,
    yardLocation: { type: S, maxlength: 60 },
    costPerCft: money(), // cost
    cost: money(), // cost
    slabThicknessMm: { type: N, min: 1, default: 30 },
    stage: { type: S, enum: ['received', 'cutting', 'cut'], default: 'received' },
    stockItemId: { type: OID }, // raw-stone stock item that holds this block's CFT
  },
  { indexes: [[{ blockNo: 1 }, liveUnique()], [{ rawanna: 1 }, liveUnique()], [{ stage: 1, blockNo: -1 }], [{ date: -1 }]] }
);

export const Royalty = defineModel(
  'Royalty',
  {
    month: monthStr({ required: true }),
    amount: money({ required: true }),
    dueDate: dateStr({ required: true }),
    paidDate: dateStr(),
    state: { type: S, enum: ['due', 'paid'], default: 'due' },
    note: S,
  },
  { indexes: [[{ month: -1 }], [{ state: 1, dueDate: 1 }]] }
);

export const Repair = defineModel(
  'Repair',
  {
    kind: { type: S, enum: ['breakdown', 'service'], required: true },
    date: dateStr({ required: true }),
    machineId: { type: OID, required: true },
    machineName: S,
    problem: { type: S, required: true, maxlength: 2000 },
    action: { type: S, maxlength: 2000 },
    spares: { type: S, maxlength: 500 },
    cost: money({ default: 0 }),
    stoppedHours: { type: N, min: 0 },
    mechanic: S,
    photo: S,
    voiceNote: S,
    reportedByCode: { type: S, uppercase: true },
    hourMeterAtService: { type: N, min: 0 },
    status: { type: S, enum: ['open', 'closed'], default: 'open' },
  },
  { indexes: [[{ machineId: 1, date: -1 }], [{ status: 1, date: -1 }], [{ date: -1 }]] }
);

export const Vehicle = defineModel(
  'Vehicle',
  {
    name: { type: S, required: true, maxlength: 80 },
    regNo: { type: S, uppercase: true, maxlength: 20 },
    kind: { type: S, enum: ['Truck', 'Tractor', 'Loader', 'Crane', 'Other'], required: true },
    driverCode: { type: S, uppercase: true },
    driverName: S, // the regular driver's name, kept with the code
    insuranceExpiry: dateStr(),
    fitnessExpiry: dateStr(),
    permitExpiry: dateStr(),
    pucExpiry: dateStr(),
    rcPhoto: S,
    notes: { type: S, maxlength: 500 },
    status: { type: S, enum: ['in', 'out'], default: 'in' },
    currentTripId: OID,
    lastKm: { type: N, min: 0 },
    lastFuel: { type: N, min: 0 },
    lastDriverName: S,
    lastOutTime: S,
  },
  { indexes: [[{ regNo: 1 }, liveUnique({ regNo: { $gt: '' } })], [{ driverCode: 1 }]] }
);

export const VehicleTrip = defineModel(
  'VehicleTrip',
  {
    date: dateStr({ required: true }),
    vehicleId: { type: OID, required: true },
    vehicleName: S,
    driverCode: { type: S, uppercase: true },
    driverName: S,
    work: { type: S, maxlength: 300 },
    hours: { type: N, min: 0 },
    km: { type: N, min: 0 },
    hourMeter: { type: N, min: 0 },
    odometer: { type: N, min: 0 },
    dieselLitres: { type: N, min: 0, required: true },
    dieselAmount: money(),
    dieselPerUnit: { type: N, min: 0 },
  },
  { indexes: [[{ vehicleId: 1, date: -1 }], [{ driverCode: 1, date: -1 }], [{ date: -1 }]] }
);

export const TruckTrip = defineModel(
  'TruckTrip',
  {
    vehicleId: { type: OID, required: true },
    truckNo: { type: S, required: true, uppercase: true },
    vehicleName: S,
    driverCode: { type: S, uppercase: true },
    driverName: { type: S, required: true },
    driverMobile: S,
    purpose: { type: S, default: 'Raw Material' },
    outDate: dateStr({ required: true }),
    outTime: { type: S, required: true },
    outKm: { type: N, min: 0, required: true },
    outFuel: { type: N, min: 0, required: true }, // fuel in L
    inDate: dateStr(),
    inTime: S,
    inKm: { type: N, min: 0 },
    inFuel: { type: N, min: 0 }, // fuel in L
    fuelAdded: { type: N, min: 0, default: 0 },
    kmTraveled: { type: N, min: 0 },
    fuelConsumed: { type: N, min: 0 }, // fuel in L
    status: { type: S, enum: ['out', 'in'], default: 'out' },
    notes: { type: S, maxlength: 500 },
  },
  {
    indexes: [
      [{ vehicleId: 1, status: 1 }],
      [{ status: 1, outDate: -1 }],
      [{ outDate: -1 }],
    ],
  }
);
