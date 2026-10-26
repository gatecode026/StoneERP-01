import { z } from 'zod';
import { Project } from '../models/projects';
import type { ResourceDef } from '../api/resource';
import { badRequest, conflict } from '../errors';
import { nextSeq, oid } from '../services/core';
import { employeeByCode } from '../services/lookup';
import { dateStr, enumOf, req, text, num, posNum, empCode } from './zod';
import { SITES, PROJECT_STATUSES, PROJECT_PRIORITIES } from '../models/projects';

export const PRJ_CODE_PREFIX = 'PRJ-';

async function nextProjectCode(ctx: any) {
  for (let i = 0; i < 20; i++) {
    const code = PRJ_CODE_PREFIX + String(await nextSeq('prj', ctx.session, 0)).padStart(4, '0');
    if (!(await Project.exists({ projectCode: code }).session(ctx.session ?? null))) return code;
  }
  throw conflict('Could not number the project. Please try again.');
}

const projectFields = {
  projectCode: z.string().trim().toUpperCase().optional(),
  name: req(200),
  clientName: text(150).optional(),
  site: enumOf(SITES).optional(),
  stoneType: text(100).optional(),
  orderNo: text(100).optional(),
  partyPoNo: text(100).optional(),
  ourSaleInvoice: text(100).optional(),
  finish: text(120).optional(),
  edges: text(120).optional(),
  sizes: text(200).optional(),
  thickness: text(100).optional(),
  qtyInSqFt: num().optional(),
  qtyInPcs: num().optional(),
  qtyInTons: num().optional(),
  units: text(50).optional(),
  price: num().optional(),
  targetQty: text(100).optional(),
  requirements: text(4000).optional(),
  deliverables: text(4000).optional(),
  supervisorCode: empCode.optional().or(z.literal('')),
  supervisorName: text(120).optional(),
  startDate: dateStr.optional(),
  targetDate: dateStr.optional(),
  status: enumOf(PROJECT_STATUSES).optional(),
  priority: enumOf(PROJECT_PRIORITIES).optional(),
  contractValue: num().optional(),
  dispatchQty: num().optional(),
  balanceOrderQty: num().optional(),
  balanceOrderAmount: num().optional(),
  otherRemark: text(2000).optional(),
  notes: text(2000).optional(),
};

export const projects: ResourceDef = {
  key: 'projects',
  model: Project,
  label: (d) => `${d.name} (${d.projectCode})`,
  listFields: [
    'projectCode', 'name', 'clientName', 'site', 'stoneType',
    'orderNo', 'partyPoNo', 'ourSaleInvoice',
    'finish', 'edges', 'sizes', 'thickness',
    'qtyInSqFt', 'qtyInPcs', 'qtyInTons', 'units', 'price',
    'targetQty', 'requirements', 'deliverables', 'supervisorCode', 'supervisorName',
    'startDate', 'targetDate', 'status', 'priority', 'contractValue',
    'dispatchQty', 'balanceOrderQty', 'balanceOrderAmount', 'otherRemark', 'notes',
    'taskCount', 'tasksDone'
  ],
  sortable: ['projectCode', 'name', 'startDate', 'targetDate', 'createdAt', 'status'],
  defaultSort: '-createdAt',
  searchFields: ['name', 'projectCode', 'clientName', 'stoneType', 'orderNo', 'partyPoNo', 'finish', 'sizes', 'supervisorName'],
  filters: {
    status: { enum: PROJECT_STATUSES as unknown as readonly string[] },
    site: { enum: SITES as unknown as readonly string[] },
    priority: { enum: PROJECT_PRIORITIES as unknown as readonly string[] },
    supervisorCode: 'string',
  },
  serverOnly: ['supervisorName', 'taskCount', 'tasksDone'],
  create: z.object(projectFields).strict(),
  update: z.object(projectFields).partial().strict(),
  lifecycle: {
    async prepareCreate(ctx, input) {
      const doc: any = { ...input };
      if (!doc.projectCode) doc.projectCode = await nextProjectCode(ctx);
      if (doc.supervisorCode) {
        try {
          const sup = await employeeByCode(ctx, doc.supervisorCode);
          doc.supervisorName = sup.name;
        } catch {
          // ignore if employee not found
        }
      }
      doc.status ??= 'In Progress';
      doc.priority ??= 'Normal';
      doc.taskCount ??= 0;
      doc.tasksDone ??= 0;
      return doc;
    },
    async prepareUpdate(ctx, prev, patch) {
      if (patch.supervisorCode && patch.supervisorCode !== prev.supervisorCode) {
        try {
          const sup = await employeeByCode(ctx, patch.supervisorCode);
          patch.supervisorName = sup.name;
        } catch {
          // ignore
        }
      }
      return patch;
    },
  },
};
