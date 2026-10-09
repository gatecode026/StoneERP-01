// End-to-end smoke test of the demo flows against a running dev server.  node scripts/smoke.mjs
const BASE = process.env.BASE || 'http://localhost:3000';
const TODAY = new Date().toISOString().slice(0, 10);
let pass = 0, fail = 0;
const ck = (role, emp) => `vss_role=${role}; vss_name=${role}${emp ? `; vss_emp=${emp}` : ''}`;
async function call(role, path, { method = 'GET', body, emp } = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Cookie: ck(role, emp) }, body: body ? JSON.stringify(body) : undefined });
  let j; try { j = await r.json(); } catch { j = null; }
  return { ok: r.ok, status: r.status, data: j };
}
function check(name, cond, extra = '') { cond ? pass++ : fail++; console.log(`${cond ? '✔' : '✘'} ${name}${cond ? '' : '  → ' + extra}`); }

// 1. worker daily report
let r = await call('worker', '/api/dailyreports', { method: 'POST', emp: 'E001', body: { narration: 'Cut 2 blocks on gang saw 1, got 410 sq ft.', hours: 9, quantity: 410, problem: 'Power cut 1 hour', plan: 'Calibrate slabs' } });
check('worker submits daily report', r.ok || /already exists/.test(r.data?.error || ''), JSON.stringify(r.data));
r = await call('worker', '/api/dailyreports', { emp: 'E001' });
check('worker sees only own reports', r.ok && r.data.every((x) => x.empCode === 'E001'), JSON.stringify(r.data).slice(0, 200));
r = await call('worker', '/api/expenses', { emp: 'E001' });
check('worker blocked from expenses', r.status === 403);
r = await call('supervisor', '/api/salarysheets');
check('supervisor blocked from salary', r.status === 403);
r = await call('supervisor', '/api/employees');
check('supervisor cannot see pay rates', r.ok && r.data.every((e) => e.rate === undefined));

// 2. machine entry
const machines = (await call('supervisor', '/api/machines')).data;
const gs1 = machines.find((m) => m.name === 'Gang saw 1');
const fin = (await call('owner', '/api/stockitems?category=finished')).data;
const natural = fin.find((x) => /600×600×30/.test(x.name));
const before = natural.balance;
r = await call('supervisor', '/api/machineentries', { method: 'POST', body: { date: TODAY, shift: 'Night', machineId: gs1._id, operatorCode: 'E001', operatorName: 'Ramesh Meena', startTime: '20:00', stopTime: '23:00', workDone: '600x600x30 natural', outputSqft: 200, stockItemId: natural._id, stoppedMins: 30, stopReason: 'Blade jam', breakdown: true } });
check('machine entry saved', r.ok, JSON.stringify(r.data));
const after = (await call('owner', `/api/stockitems/${natural._id}`)).data.balance;
check('machine output adds to stock', after === before + 200, `${before} -> ${after}`);
const reps = (await call('owner', '/api/repairs?status=open')).data;
check('breakdown auto-creates repair', reps.some((x) => x.machineName === 'Gang saw 1'), JSON.stringify(reps.map((x) => x.machineName)));

// 3. sale -> order -> dispatch -> invoice -> payment
const custs = (await call('salesperson', '/api/customers')).data;
const delhi = custs.find((c) => c.state === 'Delhi');
const pav = fin.find((x) => /pavers/i.test(x.name));
r = await call('salesperson', '/api/sales', { method: 'POST', body: { customerId: delhi._id, date: TODAY, stage: 'quotation', items: [{ stockItemId: pav._id, name: pav.name, hsn: '6802', qty: 500, unit: pav.unit, rate: 80, gstRate: 18 }] } });
check('quotation created (IGST for Delhi)', r.ok && r.data.taxType === 'igst' && r.data.total === 47200 && r.data.igst === 7200, JSON.stringify(r.data).slice(0, 300));
const sale = r.data;
r = await call('salesperson', '/api/actions', { method: 'POST', body: { action: 'saleOrder', id: sale._id, advance: 10000, advanceMode: 'UPI' } });
check('converted to order with advance', r.ok, JSON.stringify(r.data));
const pavBefore = (await call('owner', `/api/stockitems/${pav._id}`)).data.balance;
r = await call('supervisor', '/api/dispatches', { method: 'POST', body: { saleId: sale._id, direction: 'out', status: 'out', date: TODAY, items: [{ stockItemId: pav._id, name: pav.name, qty: 500, unit: pav.unit }], truckNo: 'RJ06 GA 1111', driverName: 'Test', emptyWeight: 14000, loadedWeight: 17600 } });
check('dispatch + gate pass created', r.ok && /^GP-/.test(r.data?.gatePassNo || ''), JSON.stringify(r.data));
const pavAfter = (await call('owner', `/api/stockitems/${pav._id}`)).data.balance;
check('dispatch deducts stock', pavAfter === pavBefore - 500, `${pavBefore} -> ${pavAfter}`);
r = await call('salesperson', '/api/actions', { method: 'POST', body: { action: 'saleInvoice', id: sale._id } });
check('salesperson cannot generate GST bill', r.status === 403);
r = await call('accountant', '/api/actions', { method: 'POST', body: { action: 'saleInvoice', id: sale._id } });
check('accountant generates GST invoice', r.ok && /^VSS\//.test(r.data?.invoiceNo || ''), JSON.stringify(r.data));
r = await call('accountant', '/api/payments', { method: 'POST', body: { saleId: sale._id, amount: 37200, mode: 'Bank', date: TODAY } });
check('payment recorded', r.ok, JSON.stringify(r.data));
const s2 = (await call('owner', `/api/sales/${sale._id}`)).data;
check('sale fully paid', s2.paid === 47200, `paid=${s2.paid}`);
r = await call('accountant', '/api/payments', { method: 'POST', body: { saleId: sale._id, amount: 250000, mode: 'Cash' } });
check('cash ≥ ₹2 lakh warns (409 confirmable)', r.status === 409 && r.data.confirmable);

// 4. expense > 5000 -> pending approval
r = await call('supervisor', '/api/expenses', { method: 'POST', body: { date: TODAY, head: 'Diesel', amount: 7000, paidBy: 'UPI', paidTo: 'Depot', billPhoto: 'data:image/jpeg;base64,AAAA' } });
check('expense > ₹5,000 goes to pending approval', r.ok && r.data.status === 'pending', JSON.stringify(r.data));
const exp1 = r.data;
r = await call('supervisor', '/api/expenses', { method: 'POST', body: { date: TODAY, head: 'Tea & food', amount: 100, paidBy: 'Cash' } });
check('expense without bill photo warns', r.status === 409 && r.data.confirmable);
r = await call('supervisor', '/api/approvals', { method: 'POST', body: { model: 'expenses', id: exp1._id, action: 'approve' } });
check('supervisor cannot approve', r.status === 403);
r = await call('owner', '/api/approvals', { method: 'POST', body: { model: 'expenses', id: exp1._id, action: 'approve' } });
check('owner approves expense', r.ok, JSON.stringify(r.data));

// 5. salary (previous month)
const d = new Date(); d.setDate(1); d.setDate(0);
const pm = d.toISOString().slice(0, 7);
r = await call('accountant', `/api/salary?month=${pm}`);
check('salary sheet calculated', r.ok && r.data.rows.length === 45 && r.data.totals.net > 0, JSON.stringify(r.data).slice(0, 200));
const row = r.data.rows.find((x) => x.payType === 'monthly' && x.daysPresent > 0);
console.log('   sample:', row?.name, row?.formula, 'net', row?.net);
const prow = r.data.rows.find((x) => x.payType === 'piece');
console.log('   piece:', prow?.name, prow?.formula, 'net', prow?.net);
const adv = r.data.rows.filter((x) => x.advanceRecovery > 0);
check('advance recovery applied', adv.length > 0);
r = await call('worker', `/api/salary?month=${pm}`, { emp: 'E001' });
check('worker sees only own slip', r.ok && r.data.rows.length === 1 && r.data.rows[0].empCode === 'E001', JSON.stringify(r.data).slice(0, 120));
r = await call('owner', '/api/actions', { method: 'POST', body: { action: 'salaryApprove', month: pm } });
check('owner approves salary sheet', r.ok, JSON.stringify(r.data));
r = await call('accountant', '/api/actions', { method: 'POST', body: { action: 'salaryApprove', month: pm } });
check('accountant cannot approve salary', r.status === 403 || r.status === 400);

// others
r = await call('owner', '/api/yield'); check('yield computed', r.ok && r.data.rows.some((x) => x.yieldPct), JSON.stringify(r.data).slice(0, 100));
console.log('   yield avg', r.data?.avg, 'low:', r.data?.rows.filter((x) => x.low).map((x) => x.blockNo).join(','), 'sample cost/sqft', r.data?.rows.find((x) => x.costPerSqft)?.costPerSqft);
r = await call('owner', '/api/performance'); check('performance computed', r.ok && r.data.rows.length === 45);
r = await call('owner', '/api/reminders'); check('reminders computed', r.ok && r.data.length > 0);
r = await call('owner', '/api/blocks', { method: 'POST', body: { date: TODAY, source: 'own', rawanna: 'RW/26/40331', length: 6, width: 4, height: 3, truckNo: 'RJ06 GA 1' } });
check('duplicate rawanna warns', r.status === 409 && r.data.confirmable, JSON.stringify(r.data));
r = await call('owner', '/api/blocks', { method: 'POST', body: { date: TODAY, source: 'own', rawanna: 'RW/NEW/' + Date.now(), length: 6, width: 4, height: 3 } });
check('block auto-number + CFT', r.ok && r.data.blockNo > 250 && r.data.cft === 72, JSON.stringify(r.data));
r = await call('owner', `/api/employees/${(await call('owner', '/api/employees')).data[0]._id}`, { method: 'DELETE', body: { reason: 'test' } });
check('delete = void (soft)', r.ok && r.data.status === 'void');
r = await call('owner', '/api/auditlogs?limit=5&sort=-createdAt'); check('audit trail written', r.ok && r.data.length > 0);
r = await call('owner', `/api/dashboard?date=${TODAY}`); check('dashboard ok', r.ok);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
