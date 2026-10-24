import type { ResourceDef } from '../api/resource';
import type { Resource } from '../perm/resources';
import * as people from './people';
import * as projects from './projects';
import * as production from './production';
import * as stock from './stock';
import * as selling from './selling';
import * as money from './money';

/** Every resource served by the generic /api/<resource> routes. Keys are the permission resources. */
export const DEFS: Partial<Record<Resource, ResourceDef>> = {
  employees: people.employees, dailyreports: people.dailyreports, attendance: people.attendance, leaves: people.leaves, advances: people.advances,
  perfremarks: people.perfremarks, safetyrecords: people.safetyrecords, tasks: people.tasks, projects: projects.projects,
  machines: production.machines, machineentries: production.machineentries, blocks: production.blocks, royalties: production.royalties,
  repairs: production.repairs, vehicles: production.vehicles, vehicletrips: production.vehicletrips,
  stockitems: stock.stockitems, stockmovements: stock.stockmovements, stockcounts: stock.stockcounts, suppliers: stock.suppliers, purchases: stock.purchases,
  customers: selling.customers, sales: selling.sales, payments: selling.payments, dispatches: selling.dispatches, complaints: selling.complaints,
  expenses: money.expenses, expenseheads: money.expenseheads, cashentries: money.cashentries, cashclosings: money.cashclosings,
  documents: money.documents, auditlogs: money.auditlogs,
};
export const defFor = (key: string): ResourceDef | undefined => (Object.prototype.hasOwnProperty.call(DEFS, key) ? DEFS[key as Resource] : undefined);
