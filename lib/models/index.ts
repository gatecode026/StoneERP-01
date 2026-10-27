import './auth';
import './settings';
import { Employee, Attendance, DailyReport, Leave, Advance, SalarySheet, PerfRemark, SafetyRecord, Task } from './people';
import { Machine, MachineEntry, Block, Royalty, Repair, Vehicle, VehicleTrip, TruckTrip } from './production';
import { Project } from './projects';
import { StockItem, StockMovement, StockCount, Supplier, Purchase } from './stock';
import { Customer, Sale, Payment, Dispatch, Complaint } from './sales';
import { Expense, ExpenseHead, CashEntry, CashClosing, Account } from './money';
import { PaperDoc, AuditLog, Counter, RolePermission, IdempotencyKey } from './system';
import type { AnyModel } from './_base';

export * from './auth';
export * from './settings';
export * from './people';
export * from './production';
export * from './projects';
export * from './stock';
export * from './sales';
export * from './money';
export * from './system';

/** URL/resource key -> model. */
export const MODELS: Record<string, AnyModel> = {
  employees: Employee,
  attendance: Attendance,
  dailyreports: DailyReport,
  leaves: Leave,
  advances: Advance,
  salarysheets: SalarySheet,
  perfremarks: PerfRemark,
  safetyrecords: SafetyRecord,
  tasks: Task,
  projects: Project,
  machines: Machine,
  machineentries: MachineEntry,
  blocks: Block,
  royalties: Royalty,
  repairs: Repair,
  vehicles: Vehicle,
  vehicletrips: VehicleTrip,
  trucktrips: TruckTrip,
  stockitems: StockItem,
  stockmovements: StockMovement,
  stockcounts: StockCount,
  suppliers: Supplier,
  purchases: Purchase,
  customers: Customer,
  sales: Sale,
  payments: Payment,
  dispatches: Dispatch,
  complaints: Complaint,
  expenses: Expense,
  expenseheads: ExpenseHead,
  cashentries: CashEntry,
  cashclosings: CashClosing,
  documents: PaperDoc,
  auditlogs: AuditLog,
};

export { Account, Counter, RolePermission, IdempotencyKey };
