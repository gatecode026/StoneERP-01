import { defineModel, liveUnique, dateStr, money, S, N } from './_base';

export const SITES = ['Factory', 'Yard', 'Quarry', 'Office', 'Gate', 'On-site Installation'] as const;
export const PROJECT_STATUSES = ['Planning', 'Pending', 'In Progress', 'On Hold', 'Review', 'Completed'] as const;
export const PROJECT_PRIORITIES = ['Normal', 'High', 'Urgent'] as const;

export const Project = defineModel(
  'Project',
  {
    projectCode: { type: S, required: true, trim: true, uppercase: true },
    name: { type: S, required: true, trim: true, maxlength: 200 },
    clientName: { type: S, maxlength: 150 },
    site: { type: S, enum: SITES as unknown as string[], default: 'Factory' },
    stoneType: { type: S, maxlength: 100 }, // e.g. Teakwood Sandstone, Kandla Grey, Black Granite
    // Order & invoice references
    orderNo: { type: S, maxlength: 100 },
    partyPoNo: { type: S, maxlength: 100 },
    ourSaleInvoice: { type: S, maxlength: 100 },
    // Stone specifications & attributes
    finish: { type: S, maxlength: 120 }, // e.g. Tumble, Honed, Polished, Sawn, Flamed, Shot Blast
    edges: { type: S, maxlength: 120 }, // e.g. Hand Cut, Machine Cut, Bullnose, Chamfered
    sizes: { type: S, maxlength: 200 }, // e.g. Random, 600x600 mm, 600x300 mm
    thickness: { type: S, maxlength: 100 }, // e.g. 20-25 mm, 20mm, 30mm
    // Quantities & Commercials
    qtyInSqFt: { type: N },
    qtyInPcs: { type: N },
    qtyInTons: { type: N },
    units: { type: S, maxlength: 50 },
    price: money({ default: 0 }), // Unit price / rate (₹)
    dispatchQty: { type: N, default: 0 },
    balanceOrderQty: { type: N, default: 0 },
    balanceOrderAmount: money({ default: 0 }),
    otherRemark: { type: S, maxlength: 2000 },
    targetQty: { type: S, maxlength: 100 }, // e.g. 25,000 sq ft, 150 tonnes
    requirements: { type: S, maxlength: 4000 }, // What it needs (raw blocks, machine line, packaging, tools)
    deliverables: { type: S, maxlength: 4000 }, // Deliverables (sizes, finishes, edge details, packaging)
    supervisorCode: { type: S, uppercase: true },
    supervisorName: { type: S, maxlength: 120 },
    startDate: dateStr(),
    targetDate: dateStr(),
    status: { type: S, enum: PROJECT_STATUSES as unknown as string[], default: 'In Progress' },
    priority: { type: S, enum: PROJECT_PRIORITIES as unknown as string[], default: 'Normal' },
    contractValue: money({ default: 0 }),
    notes: { type: S, maxlength: 2000 },
    taskCount: { type: N, default: 0 },
    tasksDone: { type: N, default: 0 },
  },
  {
    indexes: [
      [{ projectCode: 1 }, liveUnique()],
      [{ status: 1, targetDate: 1 }],
      [{ supervisorCode: 1 }],
      [{ name: 1 }],
    ],
  }
);
