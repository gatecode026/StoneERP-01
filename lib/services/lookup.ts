/* eslint-disable @typescript-eslint/no-explicit-any */
import { Customer, Employee, Machine, StockItem, Supplier, Sale, Block } from '../models';
import { AppError, badRequest } from '../errors';
import type { SvcCtx } from './core';

// Small "fetch or fail" helpers used inside transactions (so the rows they read are part of the snapshot).
const s = (ctx: SvcCtx) => ctx.session ?? null;

export async function employeeByCode(ctx: SvcCtx, code: string | null | undefined, opts: { active?: boolean } = {}) {
  if (!code) throw badRequest('Choose the employee');
  const e: any = await Employee.findOne({ empCode: String(code).toUpperCase(), isVoid: false }).session(s(ctx)).lean();
  if (!e) throw new AppError(400, 'BAD_REQUEST', 'Employee not found');
  if (opts.active && e.status !== 'active') throw new AppError(400, 'BAD_REQUEST', `${e.name} has left the company`);
  return e;
}
export async function machineById(ctx: SvcCtx, id: unknown) {
  const m: any = await Machine.findOne({ _id: id, isVoid: false }).session(s(ctx)).lean();
  if (!m) throw new AppError(400, 'BAD_REQUEST', 'Machine not found');
  return m;
}
export async function customerById(ctx: SvcCtx, id: unknown) {
  const c: any = await Customer.findOne({ _id: id, isVoid: false }).session(s(ctx)).lean();
  if (!c) throw new AppError(400, 'BAD_REQUEST', 'Customer not found');
  return c;
}
export async function supplierById(ctx: SvcCtx, id: unknown) {
  const x: any = await Supplier.findOne({ _id: id, isVoid: false }).session(s(ctx)).lean();
  if (!x) throw new AppError(400, 'BAD_REQUEST', 'Supplier not found');
  return x;
}
export async function stockItemById(ctx: SvcCtx, id: unknown) {
  const x: any = await StockItem.findOne({ _id: id, isVoid: false }).session(s(ctx)).lean();
  if (!x) throw new AppError(400, 'BAD_REQUEST', 'Stock item not found');
  return x;
}
export async function saleById(ctx: SvcCtx, id: unknown) {
  const x: any = await Sale.findOne({ _id: id, isVoid: false }).session(s(ctx)).lean();
  if (!x) throw new AppError(400, 'BAD_REQUEST', 'Sale not found');
  return x;
}
export async function blockByNo(ctx: SvcCtx, no: number) {
  const x: any = await Block.findOne({ blockNo: no, isVoid: false }).session(s(ctx)).lean();
  if (!x) throw new AppError(400, 'BAD_REQUEST', `Block ${no} not found`);
  return x;
}
