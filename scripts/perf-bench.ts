/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Benchmarks against the perf database made by scripts/perf-seed.ts. Never run against production.
 *   explain  --label before|after [--sync-indexes]   explain("executionStats") for every hot query -> docs/perf/explain-<label>.json
 *   http     [--base http://localhost:3100]          API latency (cold + warm, p50/p95) for each role  -> docs/perf/http.json
 *   report                                            writes docs/PERF_REPORT.md from the JSON files above
 */
import fs from 'node:fs';
import mongoose from 'mongoose';
import { connect, disconnect } from '../lib/db';
import { addDays, todayIST } from '../lib/time';
import { MODELS, Account, Customer } from '../lib/models';
import { DailySummary } from '../lib/rollup/dailySummary';
import '../lib/storage/files';

void Account;
const OUT = 'docs/perf';
fs.mkdirSync(OUT, { recursive: true });
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const mode = process.argv[2];

type Q = { name: string; run: (explain: boolean) => Promise<any> };

function planInfo(ex: any) {
  const s = JSON.stringify(ex);
  const stages = new Set<string>();
  const idx = new Set<string>();
  for (const m of s.matchAll(/"stage":"([A-Z_]+)"/g)) stages.add(m[1]);
  for (const m of s.matchAll(/"indexName":"([^"]+)"/g)) idx.add(m[1]);
  const es = ex.executionStats ?? ex.stages?.find((x: any) => x.$cursor)?.$cursor?.executionStats ?? {};
  return { stages: [...stages].filter((x) => !['LIMIT', 'PROJECTION_SIMPLE', 'PROJECTION_DEFAULT', 'SORT_KEY_GENERATOR', 'SUBPLAN', 'OR'].includes(x)), indexes: [...idx], keys: es.totalKeysExamined ?? null, docs: es.totalDocsExamined ?? null, returned: es.nReturned ?? null, ms: es.executionTimeMillis ?? null };
}

async function queries(): Promise<Q[]> {
  const today = todayIST();
  const m = MODELS as Record<string, mongoose.Model<any>>;
  const last: any = await m.dailyreports.findOne({}).sort({ date: -1 }).select('date').lean();
  const D = last?.date ?? today;
  const month = D.slice(0, 7);
  const sale: any = await m.sales.findOne({}).sort({ date: -1 }).select('_id customerId salespersonUserId').lean();
  const item: any = await m.stockitems.findOne({}).lean();
  const mach: any = await m.machines.findOne({}).lean();
  const blockNos = (await m.blocks.find({}).sort({ blockNo: -1 }).limit(400).select('blockNo').lean()).map((b: any) => b.blockNo);
  const aud: any = await mongoose.connection.collection('auditlogs').findOne({ model: 'sales' });
  const find = (model: string, filter: any, sort: any, limit: number, select?: string) => (explain: boolean) => {
    let q = m[model].find(filter).sort(sort).limit(limit);
    if (select) q = q.select(select);
    return explain ? q.explain('executionStats') : q.lean().exec();
  };
  const agg = (model: string, pipe: any[]) => (explain: boolean) => (explain ? (m[model] as any).aggregate(pipe).explain('executionStats') : (m[model] as any).aggregate(pipe));
  const live = { isVoid: false };
  return [
    { name: 'employees: active list (sort empCode)', run: find('employees', { status: 'active', ...live }, { empCode: 1, _id: 1 }, 26) },
    { name: 'employees: name prefix search', run: find('employees', { $or: [{ name: /^Employee 1/ }, { empCode: /^Employee 1/ }, { mobile: /^Employee 1/ }], ...live }, { empCode: 1, _id: 1 }, 26) },
    { name: 'dailyreports: one day (owner screen)', run: find('dailyreports', { date: D, ...live }, { empName: 1, _id: 1 }, 26) },
    { name: 'dailyreports: worker "my recent"', run: find('dailyreports', { empCode: 'E021', ...live }, { date: -1, _id: -1 }, 10) },
    { name: 'attendance: one day', run: find('attendance', { date: D, ...live }, { empCode: 1, _id: 1 }, 100) },
    { name: 'attendance: one employee, one month', run: find('attendance', { empCode: 'E021', date: { $gte: `${month}-01`, $lte: `${month}-31` }, ...live }, { date: -1, _id: -1 }, 40) },
    { name: 'sales: latest list', run: find('sales', live, { date: -1, _id: -1 }, 26) },
    { name: 'sales: stage filter + latest', run: find('sales', { stage: 'dispatched', ...live }, { date: -1, _id: -1 }, 26) },
    { name: 'sales: salesperson "my sales"', run: find('sales', { salespersonUserId: sale.salespersonUserId, ...live }, { date: -1, _id: -1 }, 26) },
    { name: 'sales: one customer', run: find('sales', { customerId: sale.customerId, ...live }, { date: -1, _id: -1 }, 26) },
    { name: 'sales: overdue receivables (reminders)', run: find('sales', { stage: { $in: ['order', 'dispatched'] }, ...live, outstanding: { $gt: 0 }, date: { $lte: addDays(today, -15) } }, { date: 1, _id: 1 }, 100) },
    { name: 'sales: receivables ageing (aggregate)', run: agg('sales', [{ $match: { stage: { $in: ['order', 'dispatched'] }, isVoid: false, outstanding: { $gt: 0 } } }, { $group: { _id: null, t: { $sum: '$outstanding' } } }]) },
    { name: 'payments: for one sale', run: find('payments', { saleId: sale._id, ...live }, { date: 1, _id: 1 }, 50) },
    { name: 'payments: one day (report)', run: find('payments', { date: D, ...live }, { _id: 1 }, 200) },
    { name: 'dispatches: for one sale', run: find('dispatches', { saleId: sale._id, ...live }, { date: 1, _id: 1 }, 50) },
    { name: 'dispatches: trucks waiting at gate', run: find('dispatches', { direction: 'out', status: 'loading', ...live }, { createdAt: 1 }, 20) },
    { name: 'dispatches: latest list', run: find('dispatches', live, { date: -1, _id: -1 }, 26) },
    { name: 'stockmovements: latest list', run: find('stockmovements', live, { date: -1, _id: -1 }, 26) },
    { name: 'stockmovements: one item', run: find('stockmovements', { itemId: item._id, ...live }, { date: -1, _id: -1 }, 26) },
    { name: 'stockitems: below minimum (alert)', run: find('stockitems', { belowMin: true, ...live }, { name: 1 }, 30) },
    { name: 'cashentries: latest list', run: find('cashentries', { type: { $in: ['in', 'out'] }, ...live }, { date: -1, _id: -1 }, 26) },
    { name: 'cashentries: one account', run: find('cashentries', { account: 'cash', ...live }, { date: -1, _id: -1 }, 26) },
    { name: 'auditlogs: history of one record', run: find('auditlogs', { refId: String(aud.refId) }, { at: -1, _id: -1 }, 50) },
    { name: 'auditlogs: latest list', run: find('auditlogs', {}, { at: -1, _id: -1 }, 26) },
    { name: 'auditlogs: one resource, latest', run: find('auditlogs', { model: 'sales' }, { at: -1, _id: -1 }, 26) },
    { name: 'machineentries: one day', run: find('machineentries', { date: D, ...live }, { date: -1, _id: -1 }, 100) },
    { name: 'machineentries: one machine, one month', run: find('machineentries', { machineId: mach._id, date: { $gte: `${month}-01`, $lte: `${month}-31` }, ...live }, { date: -1, _id: -1 }, 50) },
    { name: 'yield: output per block (aggregate, 400 blocks)', run: agg('machineentries', [{ $match: { isVoid: false, blockNo: { $in: blockNos } } }, { $group: { _id: '$blockNo', cut: { $sum: '$outputSqft' } } }]) },
    { name: 'expenses: latest list', run: find('expenses', live, { date: -1, _id: -1 }, 26) },
    { name: 'expenses: pending approval', run: find('expenses', { status: 'pending', ...live }, { createdAt: -1 }, 20) },
    { name: 'expenses: supervisor “my expenses”', run: find('expenses', { createdById: new mongoose.Types.ObjectId(), ...live }, { date: -1, _id: -1 }, 26) },
    { name: 'purchases: payable this week', run: find('purchases', { status: 'approved', ...live, outstanding: { $gt: 0 }, dueDate: { $lte: addDays(today, 7) } }, { dueDate: 1 }, 8) },
    { name: 'tasks: overdue', run: find('tasks', { state: 'pending', dueDate: { $lt: today }, ...live }, { dueDate: 1 }, 50) },
    { name: 'tasks: my open tasks', run: find('tasks', { assignedCode: 'E021', state: 'pending', ...live }, { dueDate: 1 }, 10) },
    { name: 'advances: employee’s open advances', run: find('advances', { empCode: 'E021', status: 'approved', ...live }, { date: 1 }, 20) },
    { name: 'leaves: pending', run: find('leaves', { status: 'pending', ...live }, { createdAt: -1 }, 50) },
    { name: 'complaints: open', run: find('complaints', { state: { $ne: 'closed' }, ...live }, { date: -1 }, 6) },
    { name: 'repairs: open', run: find('repairs', { status: 'open', ...live }, { date: -1 }, 15) },
    { name: 'safety: check-ups due', run: find('safetyrecords', { kind: 'checkup', ...live, dueDate: { $gt: '', $lte: addDays(today, 15) } }, { dueDate: 1 }, 50) },
    { name: 'documents: expiring papers', run: find('documents', { ...live, expiryDate: { $gt: '', $lte: addDays(today, 30) } }, { expiryDate: 1 }, 100) },
    { name: 'customers: who owes most', run: find('customers', { ...live, outstanding: { $gt: 0 } }, { outstanding: -1 }, 6) },
    { name: 'daily summary: today (owner report)', run: (ex) => (ex ? DailySummary.findById(D).explain('executionStats') : DailySummary.findById(D).lean()) },
    { name: 'daily summary: 7-day trend', run: (ex) => (ex ? DailySummary.find({ _id: { $gte: addDays(D, -6), $lte: D } }).explain('executionStats') : DailySummary.find({ _id: { $gte: addDays(D, -6), $lte: D } }).lean()) },
    { name: 'performance: month of reports', run: find('dailyreports', { date: { $gte: `${month}-01`, $lte: `${month}-31` }, ...live }, { _id: 1 }, 5000, 'empCode quantity onTime') },
  ];
}

async function median(fn: () => Promise<any>, n = 5) {
  const t: number[] = [];
  for (let i = 0; i < n; i++) { const s = process.hrtime.bigint(); await fn(); t.push(Number(process.hrtime.bigint() - s) / 1e6); }
  t.sort((a, b) => a - b);
  return +t[Math.floor(n / 2)].toFixed(1);
}

async function explainMode() {
  const label = arg('--label') ?? 'run';
  await connect();
  if (!mongoose.connection.name.startsWith('vss_perf')) throw new Error('Refusing: not a vss_perf database');
  if (process.argv.includes('--sync-indexes')) {
    const t = Date.now();
    for (const model of Object.values(mongoose.models)) await model.syncIndexes();
    console.log(`indexes built in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
  const rows = [];
  for (const q of await queries()) {
    const ex = await q.run(true);
    const info = planInfo(ex);
    const wall = await median(() => q.run(false));
    rows.push({ name: q.name, ...info, wallMs: wall });
    console.log(`${(info.stages.includes('COLLSCAN') ? 'SCAN ' : 'index').padEnd(6)} ${String(info.docs).padStart(8)} docs  ${String(wall).padStart(8)} ms  ${q.name}`);
  }
  fs.writeFileSync(`${OUT}/explain-${label}.json`, JSON.stringify(rows, null, 2));
  await disconnect();
}

// ---------------------------------------------------------------- HTTP latency
async function httpMode() {
  const base = arg('--base') ?? 'http://localhost:3100';
  const logins: [string, string][] = [['owner', '9000000001'], ['manager', '9000000002'], ['accountant', '9000000003'], ['supervisor', '9000000004'], ['salesperson', '9000000005'], ['worker', '9000000006']];
  const jars: Record<string, string> = {};
  for (const [role, mobile] of logins) {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ username: mobile, password: 'Perf@1234' }) });
    if (!r.ok) throw new Error(`login ${role}: ${r.status} ${await r.text()}`);
    jars[role] = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  }
  const day = todayIST();
  const eps: [string, string, string][] = [
    ['owner', 'home (owner report)', `/api/home?date=${day}`], ['manager', 'home (manager)', '/api/home'], ['accountant', 'home (accountant)', '/api/home'], ['supervisor', 'home (supervisor)', '/api/home'], ['salesperson', 'home (salesperson)', '/api/home'], ['worker', 'home (worker)', '/api/home'],
    ['owner', 'list employees', '/api/employees?limit=25'], ['owner', 'list sales', '/api/sales?limit=25'], ['owner', 'list sales (filtered)', '/api/sales?stage=dispatched&limit=25'], ['owner', 'list stock movements', '/api/stockmovements?limit=25'],
    ['owner', 'list cash entries', '/api/cashentries?limit=25'], ['owner', 'list expenses', '/api/expenses?limit=25'], ['owner', 'list audit log', '/api/auditlogs?limit=25'], ['owner', 'list daily reports (a day)', `/api/dailyreports?date=${day}&limit=25`],
    ['owner', 'list machine entries (a day)', `/api/machineentries?date=${day}&limit=25`], ['owner', 'yield report', '/api/yield'], ['owner', 'performance scorecards', `/api/performance?month=${day.slice(0, 7)}`], ['owner', 'reminders', '/api/reminders'], ['owner', 'accounts balance', '/api/accounts'],
    ['accountant', 'list payments', '/api/payments?limit=25'], ['supervisor', 'team daily reports', '/api/dailyreports?limit=25'], ['supervisor', 'team attendance', `/api/attendance?date=${day}&limit=100`], ['salesperson', 'my sales', '/api/sales?limit=25'], ['worker', 'my reports', '/api/dailyreports?limit=10'],
  ];
  const N = 25;
  const out = [];
  for (const [role, label, url] of eps) {
    const t: number[] = [];
    let size = 0, status = 0;
    for (let i = 0; i <= N; i++) {
      const s = process.hrtime.bigint();
      const r = await fetch(base + url, { headers: { cookie: jars[role] } });
      const body = await r.arrayBuffer();
      t.push(Number(process.hrtime.bigint() - s) / 1e6);
      size = body.byteLength; status = r.status;
    }
    const cold = t[0];
    const warm = t.slice(1).sort((a, b) => a - b);
    const q = (p: number) => +warm[Math.min(warm.length - 1, Math.floor(p * warm.length))].toFixed(1);
    out.push({ role, label, url, status, bytes: size, coldMs: +cold.toFixed(1), p50: q(0.5), p95: q(0.95), max: +warm[warm.length - 1].toFixed(1) });
    console.log(`${String(status).padEnd(4)} cold ${cold.toFixed(0).padStart(5)} ms   p50 ${String(q(0.5)).padStart(6)}   p95 ${String(q(0.95)).padStart(6)}   ${(size / 1024).toFixed(1).padStart(6)} KB   ${role}: ${label}`);
  }
  fs.writeFileSync(`${OUT}/http.json`, JSON.stringify(out, null, 2));
}

// ---------------------------------------------------------------- report
function reportMode() {
  const read = (f: string) => (fs.existsSync(`${OUT}/${f}`) ? JSON.parse(fs.readFileSync(`${OUT}/${f}`, 'utf8')) : null);
  const before = read('explain-before.json'), after = read('explain-after.json'), http = read('http.json'), meta = read('dataset.json');
  const L: string[] = ['# Performance report', '', `Generated ${new Date().toISOString().slice(0, 10)} from \`scripts/perf-seed.ts\` data (separate database, never production).`, ''];
  if (meta) L.push('## Dataset', '', '| Collection | Documents |', '|---|---:|', ...Object.entries(meta).map(([k, v]) => `| ${k} | ${Number(v).toLocaleString('en-IN')} |`), '');
  if (before && after) {
    L.push('## Query plans — before vs after indexing', '', 'Same data, same queries. **Before** = only `_id` indexes. **After** = the indexes declared in `lib/models/*` (`npm run db:indexes`). “docs” = documents examined (`executionStats.totalDocsExamined`); wall = median of 5 runs.', '',
      '| Query | Plan before | docs before | ms before | Plan after | docs after | ms after |', '|---|---|---:|---:|---|---:|---:|');
    for (const a of after) {
      const b = before.find((x: any) => x.name === a.name);
      const plan = (x: any) => (x.stages.includes('COLLSCAN') ? '**COLLSCAN**' : x.indexes.length ? `IXSCAN ${x.indexes.slice(0, 2).join(', ')}` : x.stages.join('+') || 'ID');
      L.push(`| ${a.name} | ${b ? plan(b) : '—'} | ${b?.docs?.toLocaleString('en-IN') ?? '—'} | ${b?.wallMs ?? '—'} | ${plan(a)} | ${a.docs?.toLocaleString('en-IN') ?? '—'} | ${a.wallMs} |`);
    }
    const scans = after.filter((x: any) => x.stages.includes('COLLSCAN'));
    L.push('', `**Collection scans after indexing: ${scans.length}** of ${after.length} hot queries${scans.length ? ' — ' + scans.map((x: any) => x.name).join('; ') : ''}.`, '');
  }
  if (http) {
    L.push('## API latency (production build, local machine, perf dataset)', '', 'Cold = very first request after login for that endpoint; p50 / p95 over 25 warm requests. Single user, local MongoDB — real devices add network time.', '',
      '| Role | Endpoint | Status | Size | Cold ms | p50 ms | p95 ms |', '|---|---|---:|---:|---:|---:|---:|', ...http.map((h: any) => `| ${h.role} | ${h.label} | ${h.status} | ${(h.bytes / 1024).toFixed(1)} KB | ${h.coldMs} | ${h.p50} | ${h.p95} |`), '');
  }
  fs.writeFileSync('docs/PERF_REPORT.md', L.join('\n'));
  console.log('wrote docs/PERF_REPORT.md');
}

async function datasetMode() {
  await connect();
  const out: Record<string, number> = {};
  for (const c of await mongoose.connection.db!.listCollections().toArray()) out[c.name] = await mongoose.connection.collection(c.name).countDocuments();
  fs.writeFileSync(`${OUT}/dataset.json`, JSON.stringify(out, null, 2));
  console.log(out);
  await disconnect();
}

void Customer;
(async () => {
  if (mode === 'explain') await explainMode();
  else if (mode === 'http') await httpMode();
  else if (mode === 'dataset') await datasetMode();
  else if (mode === 'report') reportMode();
  else console.log('usage: perf-bench.ts explain --label before|after [--sync-indexes] | http | dataset | report');
})().catch((e) => { console.error(e); process.exit(1); });
