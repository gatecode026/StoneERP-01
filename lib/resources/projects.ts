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
  completedPcs: num().optional(),
  completedSqFt: num().optional(),
  balancePcs: num().optional(),
  units: text(50).optional(),
  price: num().optional(),
  targetQty: text(100).optional(),
  requirements: text(4000).optional(),
  deliverables: text(4000).optional(),
  supervisorCode: z.string().optional().or(z.literal('')),
  supervisorCodes: z.array(z.string()).optional(),
  supervisorName: text(300).optional(),
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
    'qtyInSqFt', 'qtyInPcs', 'qtyInTons', 'completedPcs', 'completedSqFt', 'balancePcs', 'units', 'price',
    'targetQty', 'requirements', 'deliverables', 'supervisorCode', 'supervisorCodes', 'supervisorName',
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
      let codes: string[] = [];
      if (Array.isArray(doc.supervisorCodes) && doc.supervisorCodes.length) {
        codes = doc.supervisorCodes.map((s: string) => String(s).trim()).filter(Boolean);
      } else if (typeof doc.supervisorCode === 'string' && doc.supervisorCode.trim()) {
        codes = doc.supervisorCode.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      doc.supervisorCodes = codes;
      doc.supervisorCode = codes[0] || '';
      if (codes.length) {
        try {
          const { Employee } = await import('../models');
          const emps: any[] = await Employee.find({ empCode: { $in: codes }, isVoid: false }).select('empCode name').lean();
          if (emps.length) {
            const map = new Map(emps.map((e) => [e.empCode, e.name]));
            doc.supervisorName = codes.map((c) => map.get(c) || c).join(', ');
          }
        } catch {
          // ignore if employee not found
        }
      }
      doc.status ??= 'In Progress';
      doc.priority ??= 'Normal';
      doc.taskCount ??= 0;
      doc.tasksDone ??= 0;
      doc.completedPcs = Number(doc.completedPcs || 0);
      doc.completedSqFt = Number(doc.completedSqFt || 0);
      const targetPcs = doc.qtyInPcs != null ? Number(doc.qtyInPcs) : 0;
      if (targetPcs > 0) {
        doc.balancePcs = Math.max(0, targetPcs - doc.completedPcs);
      }
      return doc;
    },
    async prepareUpdate(ctx, prev, patch) {
      if (patch.supervisorCodes !== undefined || patch.supervisorCode !== undefined) {
        let codes: string[] = [];
        if (Array.isArray(patch.supervisorCodes)) {
          codes = patch.supervisorCodes.map((s: string) => String(s).trim()).filter(Boolean);
        } else if (typeof patch.supervisorCode === 'string') {
          codes = patch.supervisorCode.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        patch.supervisorCodes = codes;
        patch.supervisorCode = codes[0] || '';
        if (codes.length) {
          try {
            const { Employee } = await import('../models');
            const emps: any[] = await Employee.find({ empCode: { $in: codes }, isVoid: false }).select('empCode name').lean();
            if (emps.length) {
              const map = new Map(emps.map((e) => [e.empCode, e.name]));
              patch.supervisorName = codes.map((c) => map.get(c) || c).join(', ');
            }
          } catch {
            // ignore
          }
        } else {
          patch.supervisorName = '';
        }
      }
      const targetPcs = patch.qtyInPcs !== undefined ? Number(patch.qtyInPcs) : (prev.qtyInPcs !== undefined ? Number(prev.qtyInPcs) : 0);
      const donePcs = patch.completedPcs !== undefined ? Number(patch.completedPcs) : Number(prev.completedPcs || 0);
      if (targetPcs > 0) {
        patch.balancePcs = Math.max(0, targetPcs - donePcs);
      }
      return patch;
    },
  },
};
