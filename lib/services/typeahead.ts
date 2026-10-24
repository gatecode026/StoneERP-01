/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types } from 'mongoose';
import { Block, Customer, Employee, Machine, Project, Sale, StockItem, Supplier, Vehicle } from '../models';
import { badRequest, notFound } from '../errors';
import type { Resource } from '../perm/resources';
import type { AnyModel } from '../models/_base';
import { DESIGNATIONS } from '../config';

export const LOOKUP_MAX = 50;

type Kind = {
  resource: Resource;
  model: AnyModel;
  /** fields searched with an anchored prefix (index friendly) */
  search: string[];
  /** alternative value fields a dropdown may use as its id (default _id) */
  by?: string[];
  /** query filters a client may pass, each validated */
  filters?: Record<string, readonly string[] | 'oidlist' | 'string'>;
  defaults?: Record<string, any>;
  select: string;
  sort: Record<string, 1 | -1>;
  label(d: any): string;
  hint?(d: any): string | undefined;
};

const n = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN');

export const KINDS: Record<string, Kind> = {
  employees: { resource: 'employees', model: Employee, search: ['name', 'empCode'], by: ['empCode'], filters: { status: ['active', 'left'], job: 'string', designation: DESIGNATIONS, role: ['supervisor', 'worker', 'manager', 'owner', 'admin'], loginRole: ['supervisor', 'worker', 'manager', 'owner', 'admin'] }, defaults: { status: 'active' }, select: 'name empCode job designation loginRole', sort: { name: 1 }, label: (d) => `${d.name} (${d.job})`, hint: (d) => d.empCode },
  machines: { resource: 'machines', model: Machine, search: ['name'], by: ['name'], select: 'name type', sort: { name: 1 }, label: (d) => `${d.name} (${d.type})` },
  items: { resource: 'stockitems', model: StockItem, search: ['name'], filters: { category: ['raw', 'finished', 'consumable'] }, select: 'name unit balance category', sort: { name: 1 }, label: (d) => `${d.name} (${n(d.balance)} ${d.unit})`, hint: (d) => d.unit },
  customers: { resource: 'customers', model: Customer, search: ['name', 'city'], select: 'name city', sort: { name: 1 }, label: (d) => d.name, hint: (d) => d.city },
  suppliers: { resource: 'suppliers', model: Supplier, search: ['name', 'city'], select: 'name city', sort: { name: 1 }, label: (d) => d.name, hint: (d) => d.city },
  vehicles: { resource: 'vehicles', model: Vehicle, search: ['name', 'regNo'], select: 'name regNo kind', sort: { name: 1 }, label: (d) => (d.regNo ? `${d.name} (${d.regNo})` : d.name) },
  blocks: { resource: 'blocks', model: Block, search: [], by: ['blockNo'], filters: { stage: ['received', 'cutting', 'cut'], source: ['own', 'supplier'] }, select: 'blockNo cft rawanna', sort: { blockNo: -1 }, label: (d) => `Block ${d.blockNo} · ${n(d.cft)} CFT`, hint: (d) => d.rawanna },
  sales: { resource: 'sales', model: Sale, search: ['saleNo', 'customerName'], filters: { stage: ['quotation', 'order', 'dispatched'], toSend: ['1'] }, select: 'saleNo customerName stage', sort: { date: -1 }, label: (d) => `${d.saleNo} · ${d.customerName}`, hint: (d) => d.stage },
  projects: { resource: 'projects', model: Project, search: ['name', 'projectCode', 'clientName'], select: 'name projectCode clientName status', sort: { name: 1 }, label: (d) => `${d.name} (${d.projectCode})`, hint: (d) => d.clientName },
};
export const lookupKind = (k: string) => {
  if (!Object.prototype.hasOwnProperty.call(KINDS, k)) throw notFound();
  return KINDS[k];
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type LookupItem = { id: string; label: string; hint?: string };

/** {id, label} pairs for a dropdown: search, max 50, only what the caller is allowed to see (scope filter applied by the caller). */
export async function runLookup(kind: Kind, sp: URLSearchParams, scope: Record<string, any>): Promise<{ data: LookupItem[] }> {
  const by = sp.get('by');
  if (by && !(kind.by ?? []).includes(by)) throw badRequest(`Cannot use "${by}" as the id`);
  const idField = by ?? '_id';
  const and: Record<string, any>[] = [{ isVoid: false }];
  if (Object.keys(scope).length) and.push(scope);

  const filters: Record<string, any> = { ...(kind.defaults ?? {}) };
  for (const [k, v] of sp.entries()) {
    if (['q', 'by', 'ids', 'limit', 'includeLeft'].includes(k)) continue;
    const allowed = kind.filters?.[k];
    if (!allowed || allowed === 'oidlist') throw badRequest(`Unknown filter "${k}"`);
    if (allowed === 'string') { // any one or comma-separated values (e.g. "Operator" or "Supervisor,Operator")
      const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
      if (!parts.length) throw badRequest(`Filter "${k}" is empty`);
      filters[k] = parts.length > 1
        ? { $in: parts.map((p) => new RegExp(`^${escapeRe(p)}$`, 'i')) }
        : new RegExp(`^${escapeRe(parts[0])}$`, 'i');
      continue;
    }
    // toSend=1: only orders that still have stone left to send (a loading slip is made for those)
    if (k === 'toSend') { if (v === '1') filters.fullyDispatched = { $ne: true }; continue; }
    const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length || parts.some((p) => !allowed.includes(p))) throw badRequest(`Filter "${k}" must be one of: ${allowed.join(', ')}`);
    filters[k] = parts.length > 1 ? { $in: parts } : parts[0];
  }
  if (sp.get('includeLeft') === '1') delete filters.status;
  and.push(filters);

  // resolve already-chosen values to labels (edit forms, saved drafts)
  const ids = sp.get('ids');
  if (ids) {
    const list = ids.split(',').map((s) => s.trim()).filter(Boolean).slice(0, LOOKUP_MAX);
    const coerce = (v: string): unknown => (idField === '_id' ? (Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : null) : idField === 'blockNo' ? Number(v) : v);
    const vals = list.map(coerce).filter((x) => x !== null && !(typeof x === 'number' && Number.isNaN(x)));
    and.push({ [idField]: { $in: vals } });
    delete filters.status; // an old record may point at someone who has since left
  } else {
    const q = sp.get('q')?.trim().slice(0, 40);
    if (q && kind.search.length) {
      const re = new RegExp(escapeRe(q), 'i');
      and.push({ $or: kind.search.map((f) => ({ [f]: re })) });
    } else if (q && kind.model === Block) {
      const no = Number(q);
      if (Number.isFinite(no)) and.push({ blockNo: no });
    }
  }
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? LOOKUP_MAX) || LOOKUP_MAX, 1), LOOKUP_MAX);
  const rows: any[] = await kind.model.find({ $and: and }, kind.select + ' ' + idField).sort(kind.sort).limit(limit).lean();
  return { data: rows.map((d) => ({ id: String(d[idField]), label: kind.label(d), ...(kind.hint?.(d) ? { hint: kind.hint(d) } : {}) })) };
}
