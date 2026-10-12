import { MODELS, REGISTRY } from '../lib/models';
import { COMPANY, CUTTING_TYPES } from '../lib/config';
import { computeTotals, taxTypeFor } from '../lib/gst';
import { todayISO, addDays, monthOf, daysInMonth, sum } from '../lib/format';

// tiny deterministic PRNG so the demo looks the same every reset
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IMG = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#EADFCF"/><rect x="14" y="14" width="212" height="132" fill="none" stroke="#B5651D" stroke-dasharray="6 4"/><text x="120" y="88" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#7F4412">Sample photo</text></svg>'
).toString('base64');

const FIRST = ['Ramesh', 'Sunil', 'Mohan', 'Kailash', 'Suresh', 'Mahesh', 'Dinesh', 'Rakesh', 'Hanuman', 'Bhanwar', 'Gopal', 'Shankar', 'Lalit', 'Prakash', 'Naresh', 'Ramlal', 'Bheru', 'Madan', 'Jagdish', 'Kishan', 'Rajesh', 'Deepak', 'Vijay', 'Anil', 'Pappu', 'Mukesh', 'Ashok', 'Narayan', 'Devi', 'Chetan', 'Lokesh', 'Heera', 'Prem', 'Shyam', 'Nand', 'Pawan', 'Sanjay', 'Hemraj', 'Bablu', 'Ratan', 'Govind', 'Tara', 'Mangilal', 'Ganesh', 'Arjun'];
const LAST = ['Meena', 'Gurjar', 'Sharma', 'Jat', 'Regar', 'Mali', 'Choudhary', 'Rawat', 'Teli', 'Nayak', 'Jain', 'Bairwa', 'Kumawat', 'Soni', 'Paliwal'];

// [job, count, payType, rate, site, pieceUnit]
const ROSTER = [
  ['Gang saw operator', 1, 'monthly', 16000, 'Factory'],
  ['Manager', 1, 'monthly', 35000, 'Office'],
  ['Accountant', 2, 'monthly', 20000, 'Office'],
  ['Salesperson', 2, 'monthly', 19000, 'Office'],
  ['Store keeper', 1, 'monthly', 14000, 'Yard'],
  ['Supervisor', 4, 'monthly', 21000, 'Factory'],
  ['Gang saw operator', 2, 'monthly', 16000, 'Factory'],
  ['Gang saw operator', 2, 'piece', 1.5, 'Factory', 'sqft'],
  ['Block cutter operator', 2, 'piece', 1.6, 'Factory', 'sqft'],
  ['Multi-cutter operator', 2, 'monthly', 17000, 'Factory'],
  ['Polisher', 5, 'piece', 3, 'Factory', 'sqft'],
  ['Loader', 8, 'daily', 550, 'Yard'],
  ['Crane operator', 3, 'monthly', 15000, 'Yard'],
  ['Mechanic', 2, 'monthly', 17000, 'Factory'],
  ['Guard', 3, 'monthly', 11000, 'Gate'],
  ['Helper', 5, 'daily', 450, 'Factory'],
];

const NARR = {
  'Gang saw operator': ['Cut {n} blocks on gang saw, got {q} sq ft of 30 mm slabs. Blade checked at 2 pm.', 'गैंग सॉ पर {n} ब्लॉक काटे, {q} sq ft स्लैब मिले।', 'Ran gang saw all day, output {q} sq ft. Slurry changed once.'],
  'Block cutter operator': ['Block cutter: squared {n} blocks, {q} sq ft output.', 'ब्लॉक कटर से {q} sq ft काम किया।'],
  'Multi-cutter operator': ['Multi-cutter ran 9 hours, {q} sq ft strips cut.', 'मल्टी कटर पर {q} sq ft कटिंग हुई।'],
  Polisher: ['Polished {q} sq ft of slabs on line 1, 2 rejected for scratches.', '{q} sq ft पॉलिश किया, 2 पीस खराब निकले।'],
  Loader: ['Loaded 3 trucks, shifted blocks from quarry yard to factory.', '3 ट्रक लोड किए, यार्ड में ब्लॉक शिफ्ट किए।'],
  'Crane operator': ['Crane: lifted 12 blocks to gang saw bay, greasing done.', 'क्रेन से 12 ब्लॉक उठाए।'],
  Supervisor: ['Marked team attendance, supervised cutting and polishing, checked packing of 2 trucks.', 'टीम की हाज़िरी लगाई, कटिंग और पैकिंग देखी।'],
  Accountant: ['Entered purchases and bills, followed up on 3 pending customer payments.', 'बिल और पेमेंट की एंट्री की।'],
  Salesperson: ['Called 6 customers, sent 2 quotations on WhatsApp.', '2 कोटेशन भेजे, 6 ग्राहकों से बात की।'],
  Manager: ['Reviewed machine reports, approved 2 expenses, met transporter.', 'मशीन रिपोर्ट देखी, खर्च पास किए।'],
  'Store keeper': ['Counted blades and diesel, received spares from supplier.', 'ब्लेड और डीज़ल का स्टॉक गिना।'],
  Mechanic: ['Serviced gang saw 3 gearbox, changed bearings on conveyor.', 'गैंग सॉ 3 की सर्विस की।'],
  Guard: ['Gate duty, 9 trucks in/out recorded, no incident.', 'गेट ड्यूटी, ट्रक एंट्री की।'],
  Helper: ['Helped in packing and wooden crate making, cleaned yard.', 'पैकिंग और सफाई में मदद की।'],
};
const PROBLEMS = ['Power cut for 1 hour', 'Blade worn out early', 'Slurry pump choked', 'Crane waited 40 min for block', 'Water supply low in morning', 'Packing material short'];
const PLANS = ['Calibrate yesterday\'s slabs', 'Start new block on gang saw', 'Finish polishing of pavers order', 'Load Jaipur order', 'Clean machine bay'];

export async function wipeAll() {
  for (const [k, M] of Object.entries(MODELS)) await M.deleteMany({});
}

export async function runSeed() {
  const today = todayISO();
  const R = rng(7);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const ri = (a, b) => Math.floor(a + R() * (b - a + 1));
  const prevMonthStart = (() => {
    const [y, m] = today.split('-').map(Number);
    const d = new Date(y, m - 2, 1, 12);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  })();
  const seedBy = 'Demo seed';

  await wipeAll();
  const ins = async (key, docs) => {
    if (!docs.length) return [];
    const res = await MODELS[key].insertMany(docs.map((d) => ({ status: 'active', createdBy: seedBy, updatedBy: seedBy, ...d })), { ordered: false });
    return res.map((d) => d.toObject());
  };

  // ---------------- EMPLOYEES ----------------
  const emps = [];
  let idx = 0;
  const usedNames = new Set();
  for (const [job, count, payType, rate, site, pieceUnit] of ROSTER) {
    for (let i = 0; i < count; i++) {
      idx++;
      let name;
      if (idx === 1) name = 'Ramesh Meena';
      else {
        let k = 0;
        do { name = `${FIRST[(idx * 7 + i * 3 + k) % FIRST.length]} ${LAST[(idx * 5 + k * 2) % LAST.length]}`; k++; } while (usedNames.has(name));
      }
      usedNames.add(name);
      const code = 'E' + String(idx).padStart(3, '0');
      const monthlyStaff = payType === 'monthly';
      const missingDoc = [9, 17, 22, 31, 36, 41].includes(idx);
      emps.push({
        empCode: code, name, job, site, payType, rate, pieceUnit,
        mobile: `98${String(29000000 + idx * 137531).slice(0, 8)}`,
        fatherName: `${pick(FIRST)} ${name.split(' ')[1]}`,
        address: `Ward ${ri(1, 12)}, Bijoliya, Bhilwara`,
        joiningDate: addDays(today, -ri(120, 1800)),
        bankAccount: `XXXXXX${ri(1000, 9999)}`, upi: idx % 3 === 0 ? `${name.split(' ')[0].toLowerCase()}${idx}@upi` : '',
        pfApplicable: monthlyStaff && rate >= 14000 && idx % 2 === 0, pfNo: monthlyStaff && idx % 2 === 0 ? `RJ/BHL/${10000 + idx}` : '',
        esiApplicable: (monthlyStaff && rate <= 16000) || payType === 'daily',
        doc_aadhaar: IMG, doc_pan: idx % 2 ? IMG : '', doc_passbook: missingDoc ? '' : IMG, doc_license: ['Crane operator', 'Loader'].includes(job) ? IMG : '',
        emergencyName: `${pick(FIRST)} ${name.split(' ')[1]}`, emergencyMobile: `97${ri(10000000, 99999999)}`,
        photo: '', employmentStatus: 'working',
      });
    }
  }
  const empDocs = await ins('employees', emps);
  const E = emps.map((e, i) => ({ ...e, _id: String(empDocs[i]._id) }));
  const byJob = (job) => E.filter((e) => e.job === job);

  // ---------------- ATTENDANCE (prev month + this month) ----------------
  const att = [];
  const absentToday = new Set(['E013', 'E028', 'E039']);
  const overtimeToday = new Set(['E004', 'E015', 'E020', 'E033']);
  const halfToday = new Set(['E008', 'E025']);
  for (let d = prevMonthStart; d <= today; d = addDays(d, 1)) {
    for (const e of E) {
      let state = 'present', otHours;
      if (d === today) {
        state = absentToday.has(e.empCode) ? 'absent' : overtimeToday.has(e.empCode) ? 'overtime' : halfToday.has(e.empCode) ? 'half' : 'present';
      } else {
        const x = R();
        state = x < 0.045 ? 'absent' : x < 0.065 ? 'half' : x < 0.1 ? 'overtime' : x < 0.115 ? 'leave' : 'present';
        if (e.empCode === 'E001' && state === 'absent') state = 'present';
      }
      if (state === 'overtime') otHours = ri(1, 3);
      att.push({ date: d, empCode: e.empCode, employeeId: e._id, empName: e.name, state, otHours, late: state === 'present' && R() < 0.04, method: e.job === 'Guard' ? 'biometric' : 'selfie', markedBy: 'Supervisor' });
    }
  }
  await ins('attendance', att);

  // ---------------- DAILY REPORTS ----------------
  const reps = [];
  const unfilledToday = new Set(['E001', 'E013', 'E028', 'E039', 'E044']); // Ramesh has not filled yet (demo), 3 absent, 1 present
  const baseQty = { 'Gang saw operator': 380, 'Block cutter operator': 320, 'Multi-cutter operator': 360, Polisher: 190 };
  for (let d = prevMonthStart; d <= today; d = addDays(d, 1)) {
    for (const e of E) {
      const a = att.find((x) => x.date === d && x.empCode === e.empCode);
      if (!a || a.state === 'absent' || a.state === 'leave') continue;
      if (d === today ? unfilledToday.has(e.empCode) : R() < 0.06) continue;
      const q = baseQty[e.job] ? Math.round(baseQty[e.job] * (0.8 + R() * 0.4)) : 0;
      const tpl = pick(NARR[e.job] || NARR.Helper);
      const narration = tpl.replace('{n}', ri(1, 3)).replace('{q}', q);
      const prob = d === today && ['E002', 'E005', 'E010', 'E012', 'E016', 'E021'].includes(e.empCode) ? pick(PROBLEMS) : R() < 0.08 ? pick(PROBLEMS) : '';
      reps.push({
        date: d, empCode: e.empCode, employeeId: e._id, empName: e.name, job: e.job, narration, hours: a.state === 'half' ? 5 : a.state === 'overtime' ? 11 : 9,
        quantity: q, problem: prob, plan: pick(PLANS), onTime: d === today ? true : R() > 0.1, submittedAt: new Date().toISOString(),
        supCheck: d === today ? (R() < 0.5 ? 'ok' : '') : 'ok', supRemark: '', filledBy: e.job === 'Loader' || e.job === 'Helper' ? 'Supervisor' : e.name,
      });
    }
  }
  await ins('dailyreports', reps);

  // ---------------- MACHINES ----------------
  const MACH = [
    ['Gang saw 1', 'Gang saw', 'E001'], ['Gang saw 2', 'Gang saw', null], ['Gang saw 3', 'Gang saw', null], ['Block cutter 1', 'Block cutter', null],
    ['Multi-cutter 1', 'Multi-cutter', null], ['Edge cutter 1', 'Edge cutter', null], ['Calibration 1', 'Calibration', null], ['Polishing line 1', 'Polishing', null],
    ['Flaming 1', 'Flaming', null], ['Loader 1', 'Loader', null], ['Loader 2', 'Loader', null], ['Crane 1', 'Crane', null],
  ];
  const svcAgo = [30, 60, 85, 40, 20, 50, 87, 25, 15, 45, 70, 10]; // Gang saw 3 & Calibration due soon
  const machDocs = await ins('machines', MACH.map(([name, type], i) => ({
    name, type, location: type === 'Loader' || type === 'Crane' ? 'Yard' : 'Factory', purchaseDate: addDays(today, -ri(400, 2500)),
    serviceIntervalDays: 90, lastServiceDate: addDays(today, -svcAgo[i]),
  })));
  const M = MACH.map(([name, type], i) => ({ name, type, _id: String(machDocs[i]._id) }));
  const ops = {
    'Gang saw 1': E.find((e) => e.empCode === 'E001'),
    'Gang saw 2': byJob('Gang saw operator')[1], 'Gang saw 3': byJob('Gang saw operator')[2],
    'Block cutter 1': byJob('Block cutter operator')[0], 'Multi-cutter 1': byJob('Multi-cutter operator')[0],
    'Edge cutter 1': byJob('Block cutter operator')[1], 'Calibration 1': byJob('Multi-cutter operator')[1],
    'Polishing line 1': byJob('Polisher')[0], 'Flaming 1': byJob('Polisher')[1],
    'Loader 1': byJob('Loader')[0], 'Loader 2': byJob('Loader')[1], 'Crane 1': byJob('Crane operator')[0],
  };
  const todayOut = { 'Gang saw 1': 410, 'Gang saw 2': 380, 'Gang saw 3': 520, 'Block cutter 1': 640, 'Multi-cutter 1': 780, 'Edge cutter 1': 900, 'Calibration 1': 1050, 'Polishing line 1': 920, 'Flaming 1': 600 };
  const workDone = { 'Gang saw': '600 × 600 × 30 mm slabs, natural finish', 'Block cutter': 'Squared blocks for gang saw', 'Multi-cutter': 'Strips 300 mm for pavers', 'Edge cutter': 'Edge cutting of pavers', Calibration: 'Calibrated 30 mm slabs', Polishing: 'Polished slabs, honed finish', Flaming: 'Flamed finish on steps and coping' };

  const entries = [];
  const mkEntry = (m, d, out, extra = {}) => {
    const o = ops[m.name];
    const cutting = CUTTING_TYPES.includes(m.type);
    const base = {
      date: d, shift: 'Day', machineId: m._id, machineName: m.name, machineType: m.type, operatorCode: o?.empCode, operatorName: o?.name,
      startTime: '08:00', stopTime: '18:00', workDone: workDone[m.type] || 'Shifting blocks and loading', outputSqft: out, pieces: Math.round(out / 3.4),
      stoppedMins: 0, hoursRun: 9, electricityUnits: ['Loader', 'Crane'].includes(m.type) ? 0 : Math.round(60 + R() * 60),
      dieselLitres: ['Loader', 'Crane'].includes(m.type) ? ri(25, 45) : 0, bladeChanged: false, bladeCost: 0, wasteSqft: cutting ? Math.round(out * 0.04) : 0,
    };
    return { ...base, ...extra };
  };
  // this month's day-by-day entries (excluding today, which is exact)
  const monthStart = `${monthOf(today)}-01`;
  for (let d = monthStart; d < today; d = addDays(d, 1)) {
    for (const m of M) {
      const t = todayOut[m.name];
      const loaderLike = !t;
      const stop = R() < 0.18 ? ri(1, 4) * 30 : 0;
      entries.push(mkEntry(m, d, loaderLike ? 0 : Math.round(t * (0.8 + R() * 0.35) * (stop ? 0.9 : 1)), stop ? { stoppedMins: stop, stopReason: pick(['Power cut', 'Blade change', 'Slurry issue', 'Waiting for block']), hoursRun: 9 - stop / 60 } : {}));
    }
  }
  // today's entries (exactly 6,200 sq ft)
  for (const m of M) {
    const out = todayOut[m.name] || 0;
    const cutting = CUTTING_TYPES.includes(m.type);
    const blockNo = cutting ? (m.name === 'Gang saw 1' || m.name === 'Gang saw 3' ? 249 : 250) : undefined;
    let extra = { blockNo, remarks: m.name === 'Gang saw 1' ? 'Blade changed at 2 pm' : '' };
    if (m.name === 'Gang saw 1') extra = { ...extra, bladeChanged: true, bladeCost: 8500 };
    if (m.name === 'Gang saw 2') extra = { ...extra, stoppedMins: 120, stopReason: 'Breakdown – gearbox oil leak (repair)', breakdown: true, hoursRun: 7 };
    if (m.name === 'Gang saw 3') extra = { ...extra, stoppedMins: 30, stopReason: 'Power cut' };
    entries.push(mkEntry(m, today, out, extra));
  }
  // block-linked cutting history for yield (all dated >= 10 days ago)
  // ---------------- BLOCKS ----------------
  const SUPP = [
    ['Own quarry', null], ['Shree Ram Stone Mines', 'Bijoliya'], ['Mangal Minerals', 'Bundi'], ['Kailash Stone Co.', 'Bijoliya'],
  ];
  const blocks = [];
  const blockMeta = [];
  for (let n = 231; n <= 250; n++) {
    const cut = n <= 248;
    const received = addDays(today, cut ? -ri(14, 58) : -ri(2, 6));
    const si = n % 4;
    const [sname] = SUPP[si];
    const L = +(5.5 + R() * 2.5).toFixed(1), W = +(3.5 + R() * 1.5).toFixed(1), H = +(2.8 + R() * 1.2).toFixed(1);
    const cft = Math.round(L * W * H * 100) / 100;
    const own = sname === 'Own quarry';
    const costPerCft = own ? 42 : 68;
    let y = own ? 0.64 + R() * 0.07 : sname === 'Mangal Minerals' ? 0.43 + R() * 0.06 : 0.55 + R() * 0.1;
    blocks.push({
      blockNo: n, date: received, source: own ? 'own' : 'supplier', supplierName: sname, truckNo: `RJ06 G${pick(['A', 'B', 'C'])} ${ri(1000, 9999)}`,
      rawanna: `RW/26/${String(40100 + n)}`, length: L, width: W, height: H, cft, weight: Math.round(cft * 0.071 * 100) / 100,
      grade: R() < 0.7 ? 'A' : 'B', yardLocation: `Row ${ri(1, 6)}`, costPerCft, cost: Math.round(cft * costPerCft),
      stage: cut ? 'cut' : 'cutting', slabThicknessMm: 30, photo: IMG, rawannaPhoto: IMG,
    });
    blockMeta.push({ n, cut, received, cft, y });
  }
  await ins('blocks', blocks);
  for (const bm of blockMeta) {
    if (!bm.cut) continue;
    const theor = (bm.cft * 304.8) / 30;
    const cutTotal = (theor * bm.y) / 0.96;
    const cuttingMachines = M.filter((m) => CUTTING_TYPES.includes(m.type));
    const parts = bm.n % 2 ? 2 : 3;
    for (let p = 0; p < parts; p++) {
      const m = cuttingMachines[(bm.n + p) % cuttingMachines.length];
      const out = Math.round(cutTotal / parts);
      const d = addDays(bm.received, 1 + p);
      const dd = d > addDays(today, -10) ? addDays(today, -10) : d;
      entries.push(mkEntry(m, dd, out, { blockNo: bm.n, shift: 'Day', wasteSqft: Math.round(out * 0.04), bladeCost: p === 0 ? ri(400, 900) : 0, remarks: 'Yield tracking' }));
    }
  }
  await ins('machineentries', entries);

  // ---------------- STOCK ----------------
  const ITEMS = [
    ['600×600×30 mm natural', 'finished', 'sq ft', 850, 1200, 78, 52, '600×600', 30, 'Natural', 'A', 'Rack F1'],
    ['Kandla grey 600×300×25 mm', 'finished', 'sq ft', 4200, 1500, 80, 54, '600×300', 25, 'Honed', 'A', 'Rack F2'],
    ['Bijoliya sandstone pavers 300×300×30 mm', 'finished', 'sq ft', 3600, 1000, 80, 50, '300×300', 30, 'Natural', 'A', 'Rack F3'],
    ['Copings 600×300×50 mm', 'finished', 'pieces', 860, 200, 190, 120, '600×300', 50, 'Flamed', 'A', 'Rack F4'],
    ['Steps 1200×300×150 mm', 'finished', 'pieces', 240, 60, 950, 640, '1200×300', 150, 'Flamed', 'A', 'Rack F5'],
    ['Cobbles 100×100×50 mm (kandla)', 'finished', 'tonne', 38, 10, 9500, 6200, '100×100', 50, 'Natural', 'A', 'Bay C1'],
    ['Wall cladding 600×150×15 mm', 'finished', 'sq ft', 5200, 1500, 80, 49, '600×150', 15, 'Split face', 'A', 'Rack F6'],
    ['Sandstone blocks (Bijoliya)', 'raw', 'CFT', 1850, 600, 0, 55, '', 0, '', 'A', 'Yard Row 1-6'],
    ['Khanda (waste pieces)', 'raw', 'tonne', 62, 0, 0, 800, '', 0, '', 'B', 'Yard Row 7'],
    ['Diamond blade 600 mm', 'consumable', 'pieces', 14, 6, 0, 8500, '', 0, '', '', 'Store'],
    ['Diesel', 'consumable', 'litres', 2400, 800, 0, 92, '', 0, '', '', 'Diesel tank'],
    ['Packing material (wooden crates)', 'consumable', 'pieces', 120, 40, 0, 650, '', 0, '', '', 'Store'],
    ['Spares – bearings & belts', 'consumable', 'pieces', 30, 10, 0, 1400, '', 0, '', '', 'Store'],
  ];
  const itemDocs = await ins('stockitems', ITEMS.map(([name, category, unit, balance, minLevel, sellRate, costRate, size, thickness, finish, grade, location]) => ({
    name, category, unit, balance, minLevel, sellRate, costRate, size, thickness, finish, grade, location, photo: '',
  })));
  const IT = Object.fromEntries(ITEMS.map((x, i) => [x[0], { id: String(itemDocs[i]._id), unit: x[2], sell: x[5] }]));
  const itemId = (n) => IT[n].id;

  // ---------------- CUSTOMERS ----------------
  const CUST = [
    ['Greenfield Landscapes Ltd', 'London', 'England', 'UK'], ['Oakridge Paving Ltd', 'Manchester', 'England', 'UK'], ['Riverside Garden Centres', 'Bristol', 'England', 'UK'],
    ['Maple Ridge Stoneworks', 'Toronto', 'Ontario', 'Canada'], ['Northern Hardscapes Inc.', 'Vancouver', 'British Columbia', 'Canada'],
    ['Shiv Shakti Builders', 'New Delhi', 'Delhi', 'India'], ['Capital Infra Projects', 'New Delhi', 'Delhi', 'India'],
    ['Pink City Tiles & Stones', 'Jaipur', 'Rajasthan', 'India'], ['Rajputana Constructions', 'Jaipur', 'Rajasthan', 'India'],
    ['Marine Drive Developers', 'Mumbai', 'Maharashtra', 'India'], ['Sahyadri Builders', 'Mumbai', 'Maharashtra', 'India'],
    ['Gujarat Stone Mart', 'Ahmedabad', 'Gujarat', 'India'], ['Lake City Stone Traders', 'Udaipur', 'Rajasthan', 'India'],
    ['Mewar Construction Co.', 'Bhilwara', 'Rajasthan', 'India'], ['RD Natural Stones (Showroom)', 'Mandsaur', 'Madhya Pradesh', 'India'],
  ];
  const custDocs = await ins('customers', CUST.map(([name, city, state, country], i) => ({
    name, city, state, country, mobile: country === 'India' ? `9${ri(100000000, 999999999)}` : `+44 7${ri(100000000, 999999999)}`,
    gstin: country === 'India' ? `${{ Delhi: '07', Rajasthan: '08', Maharashtra: '27', Gujarat: '24', 'Madhya Pradesh': '23' }[state]}${'ABCDE'}${1000 + i * 37}F1Z${i % 9}` : '',
    address: `${ri(1, 120)}, Main Road, ${city}`, type: country === 'India' ? 'Domestic' : 'Export',
  })));
  const C = CUST.map((c, i) => ({ name: c[0], state: c[2], country: c[3], _id: String(custDocs[i]._id), mobile: custDocs[i].mobile, gstin: custDocs[i].gstin, address: custDocs[i].address }));
  const cust = (n) => C.find((c) => c.name === n);

  // ---------------- SALES ----------------
  const P30 = 'Bijoliya sandstone pavers 300×300×30 mm', KG = 'Kandla grey 600×300×25 mm', CL = 'Wall cladding 600×150×15 mm';
  const SALES = [
    { n: 1, cust: 'Shiv Shakti Builders', age: 0, stage: 'order', item: P30, qty: 1250, rate: 80, adv: 50000, advMode: 'UPI', advAge: 0, sp: 'E004' },
    { n: 2, cust: 'Greenfield Landscapes Ltd', age: 0, stage: 'order', item: KG, qty: 2020, rate: 100, sp: 'E005' },
    { n: 3, cust: 'Oakridge Paving Ltd', age: 12, stage: 'dispatched', item: CL, qty: 4200, rate: 100, pays: [[12, 100000, 'Bank'], [0, 100000, 'Bank']], inv: true, sp: 'E005' },
    { n: 4, cust: 'Pink City Tiles & Stones', age: 6, stage: 'dispatched', item: P30, qty: 3125, rate: 80, pays: [[6, 50000, 'UPI'], [0, 60000, 'Cash']], inv: true, sp: 'E004' },
    { n: 5, cust: 'Marine Drive Developers', age: 5, stage: 'dispatched', item: KG, qty: 5000, rate: 80, pays: [[5, 100000, 'Cheque']], inv: true, sp: 'E004' },
    { n: 6, cust: 'Maple Ridge Stoneworks', age: 18, stage: 'dispatched', item: P30, qty: 3800, rate: 100, pays: [[18, 150000, 'Bank']], inv: true, sp: 'E005' },
    { n: 7, cust: 'Capital Infra Projects', age: 40, stage: 'dispatched', item: CL, qty: 6250, rate: 80, pays: [[35, 200000, 'Bank']], inv: true, sp: 'E004' },
    { n: 8, cust: 'Rajputana Constructions', age: 25, stage: 'dispatched', item: P30, qty: 3750, rate: 80, pays: [[20, 171000, 'UPI']], inv: true, sp: 'E004' },
    { n: 9, cust: 'Lake City Stone Traders', age: 2, stage: 'quotation', item: KG, qty: 1800, rate: 82, sp: 'E005' },
    { n: 10, cust: 'Gujarat Stone Mart', age: 1, stage: 'quotation', item: P30, qty: 2400, rate: 79, sp: 'E004' },
  ];
  const saleDocs = [];
  const payments = [];
  let invSeq = 0;
  const saleIds = {};
  for (const s of SALES) {
    const c = cust(s.cust);
    const taxType = taxTypeFor(c);
    const t = computeTotals([{ stockItemId: itemId(s.item), name: s.item, hsn: '6802', qty: s.qty, unit: IT[s.item].unit, rate: s.rate, gstRate: 18 }], taxType);
    const date = addDays(today, -s.age);
    const doc = {
      saleNo: 'SO-' + String(s.n).padStart(4, '0'), date, stage: s.stage, customerId: c._id, customerName: c.name, customerGstin: c.gstin, customerState: c.state,
      customerCountry: c.country, customerAddress: c.address, customerMobile: c.mobile, taxType, items: t.rows, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst,
      igst: t.igst, roundOff: t.roundOff, total: t.total, paid: 0, salesperson: E.find((e) => e.empCode === s.sp).name,
    };
    if (s.inv) { invSeq++; doc.invoiceNo = `VSS/26-27/${String(invSeq).padStart(4, '0')}`; doc.invoiceDate = date; }
    const allPays = [...(s.pays || [])];
    if (s.adv) allPays.push([s.advAge, s.adv, s.advMode]);
    doc.paid = sum(allPays, (p) => p[1]);
    saleDocs.push({ s, doc, allPays });
  }
  const insertedSales = await ins('sales', saleDocs.map((x) => x.doc));
  insertedSales.forEach((d, i) => { saleIds[saleDocs[i].s.n] = String(d._id); });
  saleDocs.forEach((x) => x.allPays.forEach(([age, amt, mode], k) => payments.push({
    saleId: saleIds[x.s.n], saleNo: x.doc.saleNo, customerId: x.doc.customerId, customerName: x.doc.customerName, amount: amt, mode,
    date: addDays(today, -age), kind: x.s.adv && k === x.allPays.length - 1 ? 'advance' : 'payment', ref: mode === 'Cheque' ? 'CHQ 004512' : '',
  })));
  await ins('payments', payments);

  // ---------------- DISPATCHES ----------------
  const trucks = ['RJ06 GA 4521', 'RJ27 GB 7788', 'RJ06 GC 1290', 'GJ01 XT 5530', 'RJ14 GA 8841', 'MP09 HG 2214'];
  const drivers = ['Bhura Singh', 'Gopal Lal', 'Rajveer', 'Imran Khan', 'Sohan Lal', 'Mangu Ram'];
  const disp = [];
  let gp = 30;
  const mkDisp = (saleN, age, item, qty, i, extra = {}) => {
    gp++;
    const sd = saleDocs.find((x) => x.s.n === saleN).doc;
    const w0 = 14000 + ri(0, 1500), net = Math.round(qty * (item === CL ? 0.0045 : 0.0072) * 1000) / 1000 * 1000;
    return {
      gatePassNo: 'GP-' + String(gp).padStart(4, '0'), direction: 'out', status: 'out', date: addDays(today, -age), saleId: saleIds[saleN], saleNo: sd.saleNo,
      customerName: sd.customerName, customerMobile: sd.customerMobile, invoiceNo: sd.invoiceNo, items: [{ stockItemId: itemId(item), name: item, qty, unit: IT[item].unit }],
      truckNo: trucks[i % trucks.length], driverName: drivers[i % drivers.length], driverMobile: `9${ri(100000000, 999999999)}`, transporter: pick(['Jai Ambe Transport', 'Mewar Roadlines', 'Shakti Cargo']),
      freight: ri(14, 38) * 1000, freightPaid: R() < 0.6 ? 1 : 0, emptyWeight: w0, loadedWeight: w0 + Math.round(net), netWeight: Math.round(net), eway: `1214${ri(10000000, 99999999)}`,
      photoLoaded: IMG, photoCovered: IMG, outAt: new Date(`${addDays(today, -age)}T${ri(10, 17)}:20:00`).toISOString(), guard: 'Gate Guard', ...extra,
    };
  };
  disp.push(mkDisp(3, 0, CL, 1500, 0), mkDisp(4, 0, P30, 1200, 1), mkDisp(5, 0, KG, 2000, 2), mkDisp(6, 0, P30, 1000, 3));
  disp.push(mkDisp(3, 4, CL, 1500, 4), mkDisp(5, 3, KG, 1800, 5), mkDisp(6, 9, P30, 2800, 0), mkDisp(7, 30, CL, 6250, 1), mkDisp(8, 14, P30, 3750, 2));
  // gate counter: loading slip waiting + incoming blocks
  disp.push({ gatePassNo: 'GP-' + String(++gp).padStart(4, '0'), direction: 'out', status: 'loading', date: today, saleId: saleIds[1], saleNo: 'SO-0001', customerName: 'Shiv Shakti Builders', customerMobile: cust('Shiv Shakti Builders').mobile, items: [{ stockItemId: itemId(P30), name: P30, qty: 600, unit: 'sq ft' }], truckNo: 'HR55 AB 3021', driverName: 'Balbir', driverMobile: '9812345678', transporter: 'Mewar Roadlines', freight: 22000, freightPaid: 0 });
  disp.push({ direction: 'in', status: 'in', date: today, kind: 'Blocks', truckNo: 'RJ06 GA 3377', driverName: 'Kanha', transporter: 'Own quarry', note: 'Block 250 from own quarry', gatePassNo: '', emptyWeight: 13800, loadedWeight: 21600, netWeight: 7800 });
  disp.push({ direction: 'in', status: 'in', date: addDays(today, -2), kind: 'Purchase', truckNo: 'RJ27 GD 9012', driverName: 'Rafiq', transporter: 'Local', note: 'Diamond blades and packing crates', gatePassNo: '' });
  await ins('dispatches', disp);

  // ---------------- SUPPLIERS & PURCHASES ----------------
  const supDocs = await ins('suppliers', [
    { name: 'Shree Ram Stone Mines', mobile: '9414011111', gstin: '08AAACS1111A1Z1', city: 'Bijoliya', supplies: 'Sandstone blocks' },
    { name: 'Mangal Minerals', mobile: '9414022222', gstin: '08AAACM2222B1Z2', city: 'Bundi', supplies: 'Sandstone blocks' },
    { name: 'Kailash Stone Co.', mobile: '9414033333', gstin: '08AAACK3333C1Z3', city: 'Bijoliya', supplies: 'Sandstone blocks, khanda' },
    { name: 'Diamond Tools Jaipur', mobile: '9829044444', gstin: '08AAACD4444D1Z4', city: 'Jaipur', supplies: 'Diamond blades, segments' },
    { name: 'Bhilwara Diesel Depot', mobile: '9414055555', gstin: '08AAACB5555E1Z5', city: 'Bhilwara', supplies: 'Diesel' },
    { name: 'Sharma Spares & Packing', mobile: '9414066666', gstin: '08AAACS6666F1Z6', city: 'Bhilwara', supplies: 'Spares, wooden crates' },
  ]);
  const SU = supDocs.map((s) => ({ id: String(s._id), name: s.name }));
  const supBy = (n) => SU.find((s) => s.name === n);
  const PUR = [
    ['Diamond Tools Jaipur', 'Diamond blade 600 mm', 4, 8500, 38, 0, 5], ['Diamond Tools Jaipur', 'Diamond blade 600 mm', 3, 8200, 21, 1, -1],
    ['Bhilwara Diesel Depot', 'Diesel', 1500, 90, 12, 0, 2], ['Bhilwara Diesel Depot', 'Diesel', 1500, 92, 3, 0, 12],
    ['Sharma Spares & Packing', 'Packing material (wooden crates)', 100, 640, 15, 1, -1], ['Sharma Spares & Packing', 'Spares – bearings & belts', 20, 1350, 9, 0, 9],
    ['Shree Ram Stone Mines', 'Sandstone blocks (Bijoliya)', 420, 68, 33, 1, -1], ['Mangal Minerals', 'Sandstone blocks (Bijoliya)', 380, 65, 20, 0, 1],
    ['Kailash Stone Co.', 'Sandstone blocks (Bijoliya)', 350, 70, 8, 0, 14], ['Kailash Stone Co.', 'Khanda (waste pieces)', 20, 800, 5, 1, -1],
  ];
  await ins('purchases', PUR.map(([sup, item, qty, rate, age, paidNow, dueIn], i) => ({
    date: addDays(today, -age), supplierId: supBy(sup).id, supplierName: sup, itemId: itemId(item), itemName: item, qty, rate, unit: IT[item].unit,
    total: qty * rate, paidAmount: paidNow ? qty * rate : 0, paidNow: !!paidNow, payMode: paidNow ? 'Bank' : undefined,
    dueDate: paidNow ? '' : addDays(today, dueIn), billNo: `B-${2200 + i}`, billPhoto: IMG, prevRate: i % 3 ? rate - 100 : null, status: 'approved',
  })));
  await ins('royalties', [
    { month: monthOf(addDays(today, -62)), amount: 48500, dueDate: addDays(today, -40), paidDate: addDays(today, -42), note: 'Own quarry royalty – Bijoliya lease', state: 'paid' },
    { month: monthOf(addDays(today, -31)), amount: 52200, dueDate: addDays(today, -10), paidDate: addDays(today, -11), note: 'Own quarry royalty', state: 'paid' },
    { month: monthOf(today), amount: 50800, dueDate: addDays(today, 6), paidDate: '', note: 'Own quarry royalty', state: 'due' },
  ]);

  // ---------------- EXPENSES ----------------
  const hq = (head, amount, paidBy, paidTo, spentBy, site, narration, status = 'approved') => ({ date: today, head, amount, paidBy, paidTo, spentBy, site, narration, status, billPhoto: IMG, approvedBy: status === 'approved' && amount > 5000 ? 'Owner' : undefined });
  const expenses = [
    hq('Diesel', 9800, 'Bank', 'Bhilwara Diesel Depot', 'Store keeper', 'Loader 1', 'Diesel for loaders and crane, 106 litres', 'pending'),
    hq('Blades & spares', 6200, 'UPI', 'Diamond Tools Jaipur', 'Manager', 'Gang saw 1', 'Segment set for blade repair', 'pending'),
    hq('Transport & freight', 5400, 'Cash', 'Jai Ambe Transport', 'Accountant', 'Dispatch', 'Freight advance for Mumbai truck', 'pending'),
    hq('Tea & food', 900, 'Cash', 'Gate canteen', 'Supervisor', 'Factory', 'Tea and snacks for night shift'),
    hq('Loading-unloading labour', 1500, 'Cash', 'Contract labour', 'Supervisor', 'Yard', 'Unloading of block truck'),
    hq('Phone', 500, 'Cash', 'Airtel recharge', 'Accountant', 'Office', 'Office phone recharge'),
  ];
  const heads = ['Diesel', 'Electricity', 'Machine repair', 'Blades & spares', 'Transport & freight', 'Loading-unloading labour', 'Tea & food', 'Office', 'Phone', 'Travel', 'Rent'];
  for (let a = 1; a <= 28; a++) {
    for (let k = 0; k < 3; k++) {
      const head = pick(heads);
      const amount = head === 'Rent' ? 25000 : head === 'Electricity' ? ri(18, 30) * 1000 : head === 'Diesel' ? ri(7, 14) * 1000 : ri(3, 40) * 100;
      expenses.push({ date: addDays(today, -a), head, amount, paidBy: pick(['Cash', 'UPI', 'Bank']), paidTo: pick(['Local shop', 'Bhilwara Diesel Depot', 'Sharma Spares', 'Rajasthan Discom', 'Mewar Roadlines']), spentBy: pick(['Manager', 'Accountant', 'Supervisor', 'Store keeper']), site: pick(['Factory', 'Yard', 'Office', 'Loader 1']), narration: `${head} expense`, status: 'approved', billPhoto: IMG, approvedBy: amount > 5000 ? 'Owner' : undefined });
    }
  }
  await ins('expenses', expenses);

  // ---------------- CASH BOOK ----------------
  const cash = [];
  cash.push({ date: today, account: 'cash', type: 'in', amount: 60000, head: 'Customer payment', ref: 'SO-0004', note: 'Pink City Tiles & Stones' });
  cash.push({ date: today, account: 'bank', type: 'in', amount: 150000, head: 'Customer payment', ref: 'SO-0001/0003', note: 'UPI / bank receipts' });
  expenses.filter((x) => x.status === 'approved' && /cash/i.test(x.paidBy)).forEach((x) => cash.push({ date: x.date, account: 'cash', type: 'out', amount: x.amount, head: x.head, ref: 'Expense', note: x.narration }));
  expenses.filter((x) => x.status === 'approved' && /bank|upi/i.test(x.paidBy)).forEach((x) => cash.push({ date: x.date, account: 'bank', type: 'out', amount: x.amount, head: x.head, ref: 'Expense', note: x.narration }));
  for (let a = 1; a <= 25; a += 4) cash.push({ date: addDays(today, -a), account: 'cash', type: 'in', amount: 30000, head: 'Cash withdrawn from bank', ref: 'Cheque' });
  for (let a = 1; a <= 25; a += 4) cash.push({ date: addDays(today, -a), account: 'bank', type: 'out', amount: 30000, head: 'Cash withdrawn', ref: 'Cheque' });
  const net = (acct) => sum(cash.filter((c) => c.account === acct), (c) => (c.type === 'in' ? c.amount : -c.amount));
  cash.unshift({ date: addDays(today, -60), account: 'cash', type: 'in', amount: 46000 - net('cash'), head: 'Opening balance', ref: 'Opening' });
  cash.unshift({ date: addDays(today, -60), account: 'bank', type: 'in', amount: 1240000 - net('bank'), head: 'Opening balance', ref: 'Opening' });
  cash.push({ date: addDays(today, -1), account: 'cash', type: 'close', kind: 'closing', amount: 0, systemBalance: 52500, counted: 52500, difference: 0, note: 'Closing cash confirmed', confirmedBy: 'Cashier' });
  cash.push({ date: addDays(today, -3), account: 'cash', type: 'close', kind: 'closing', amount: 0, systemBalance: 47800, counted: 47600, difference: -200, note: 'Short by ₹200 — flagged to owner', confirmedBy: 'Cashier' });
  await ins('cashentries', cash);

  // ---------------- REPAIRS ----------------
  const mid = (n) => M.find((m) => m.name === n)._id;
  await ins('repairs', [
    { kind: 'breakdown', status: 'open', date: today, machineId: mid('Gang saw 2'), machineName: 'Gang saw 2', problem: 'Gearbox oil leak, machine stopped', stoppedHours: 2, reportedBy: ops['Gang saw 2'].name, mechanic: E.find((e) => e.job === 'Mechanic').name, cost: 0, photo: IMG },
    { kind: 'breakdown', status: 'closed', date: addDays(today, -6), machineId: mid('Polishing line 1'), machineName: 'Polishing line 1', problem: 'Polishing head motor tripped', action: 'Replaced motor contactor', spares: 'Contactor 32A', cost: 3800, stoppedHours: 4, mechanic: E.find((e) => e.job === 'Mechanic').name },
    { kind: 'breakdown', status: 'closed', date: addDays(today, -14), machineId: mid('Gang saw 3'), machineName: 'Gang saw 3', problem: 'Blade wire broke', action: 'Replaced blade pack and re-tensioned', spares: 'Diamond blade 600 mm × 2', cost: 17000, stoppedHours: 6, mechanic: E.find((e) => e.job === 'Mechanic').name },
    { kind: 'service', status: 'closed', date: addDays(today, -30), machineId: mid('Gang saw 1'), machineName: 'Gang saw 1', problem: 'Quarterly service', action: 'Oil change, belt check, greasing', spares: 'Gear oil 20 L', cost: 6200, stoppedHours: 3, mechanic: E.find((e) => e.job === 'Mechanic').name },
    { kind: 'service', status: 'closed', date: addDays(today, -40), machineId: mid('Block cutter 1'), machineName: 'Block cutter 1', problem: 'Quarterly service', action: 'Blade flange check, greasing', spares: '', cost: 2400, stoppedHours: 2, mechanic: E.find((e) => e.job === 'Mechanic')?.name },
  ]);

  // ---------------- COMPLAINTS ----------------
  const sup = byJob('Supervisor');
  await ins('complaints', [
    { complaintNo: 'CMP-001', date: addDays(today, -4), customerId: cust('Pink City Tiles & Stones')._id, customerName: 'Pink City Tiles & Stones', invoiceNo: 'VSS/26-27/0002', problem: 'Broken pieces', details: '14 pavers broken in transit', state: 'open', action: '', linkedCode: E.find((e) => e.job === 'Loader').empCode, photo: IMG },
    { complaintNo: 'CMP-002', date: addDays(today, -9), customerId: cust('Oakridge Paving Ltd')._id, customerName: 'Oakridge Paving Ltd', invoiceNo: 'VSS/26-27/0001', problem: 'Colour difference', details: 'Batch 2 slightly lighter than sample', state: 'in_progress', action: 'discount', linkedCode: sup[0].empCode, photo: IMG },
    { complaintNo: 'CMP-003', date: addDays(today, -16), customerId: cust('Marine Drive Developers')._id, customerName: 'Marine Drive Developers', invoiceNo: 'VSS/26-27/0003', problem: 'Short quantity', details: '40 sq ft short in 2000 sq ft', state: 'closed', action: 'replace', closedDate: addDays(today, -12), daysTaken: 4, linkedCode: sup[1].empCode },
    { complaintNo: 'CMP-004', date: addDays(today, -30), customerId: cust('Rajputana Constructions')._id, customerName: 'Rajputana Constructions', invoiceNo: 'VSS/26-27/0006', problem: 'Wrong size', details: 'Received 300×300, ordered 300×600', state: 'closed', action: 'credit_note', closedDate: addDays(today, -24), daysTaken: 6, linkedCode: sup[0].empCode },
  ]);

  // ---------------- TASKS ----------------
  const tk = (title, code, due, state = 'pending', extra = {}) => ({ title, assignedCode: code, assignedName: E.find((e) => e.empCode === code)?.name, dueDate: due, state, assignedBy: 'Owner', ...extra });
  await ins('tasks', [
    tk('Check rawanna photos of blocks 249–250', sup[0].empCode, addDays(today, 1)),
    tk('Get Gang saw 2 gearbox repaired before tomorrow', E.find((e) => e.job === 'Mechanic').empCode, addDays(today, 0)),
    tk('Count blade stock and update', E.find((e) => e.job === 'Store keeper').empCode, addDays(today, -2)),
    tk('Follow up Capital Infra payment', E.find((e) => e.job === 'Accountant').empCode, addDays(today, -1)),
    tk('Send revised quotation to Lake City', E.find((e) => e.empCode === 'E005').empCode, addDays(today, 2)),
    tk('Clean yard rows 3–4', sup[1].empCode, addDays(today, -3), 'done', { doneAt: new Date().toISOString(), doneNote: 'Done, photo attached', donePhoto: IMG }),
    tk('Fill PUC for truck RJ06 GA 4521', sup[2].empCode, addDays(today, 5)),
    tk('Weekly safety gear check', sup[3].empCode, addDays(today, 3)),
  ]);

  // ---------------- VEHICLES ----------------
  const vehDocs = await ins('vehicles', [
    { name: 'Truck RJ06 GA 4521', regNo: 'RJ06 GA 4521', kind: 'Truck', insuranceExpiry: addDays(today, 24), fitnessExpiry: addDays(today, 140), permitExpiry: addDays(today, 200), pucExpiry: addDays(today, 6) },
    { name: 'Truck RJ27 GB 7788', regNo: 'RJ27 GB 7788', kind: 'Truck', insuranceExpiry: addDays(today, 90), fitnessExpiry: addDays(today, 60), permitExpiry: addDays(today, 300), pucExpiry: addDays(today, 70) },
    { name: 'Tractor RJ06 TA 3320', regNo: 'RJ06 TA 3320', kind: 'Tractor', insuranceExpiry: addDays(today, 160), fitnessExpiry: addDays(today, 220), permitExpiry: '', pucExpiry: addDays(today, 100) },
    { name: 'Loader 1', regNo: 'Loader 1', kind: 'Loader', insuranceExpiry: addDays(today, 110), fitnessExpiry: '', permitExpiry: '', pucExpiry: '' },
    { name: 'Crane 1', regNo: 'Crane 1', kind: 'Crane', insuranceExpiry: addDays(today, 75), fitnessExpiry: addDays(today, 130), permitExpiry: '', pucExpiry: '' },
  ]);
  const V = vehDocs.map((v) => ({ id: String(v._id), name: v.name, kind: v.kind }));
  const trips = [];
  for (let a = 0; a < 8; a++) {
    V.forEach((v, i) => {
      if (R() < 0.35 && a > 0) return;
      const hoursBased = ['Loader', 'Crane', 'Tractor'].includes(v.kind);
      const hours = hoursBased ? ri(5, 9) : 0, km = hoursBased ? 0 : ri(40, 220);
      const litres = hoursBased ? Math.round(hours * (v.kind === 'Crane' ? 5.2 : 4) + R() * 4) : Math.round(km / 3.8);
      trips.push({ date: addDays(today, -a), vehicleId: v.id, vehicleName: v.name, driverName: pick(drivers), work: hoursBased ? 'Block shifting quarry → factory' : pick(['Dispatch to Jaipur', 'Block from quarry', 'Dispatch to Delhi']), hours, km, dieselLitres: litres, dieselAmount: litres * 92, dieselPerUnit: Math.round((litres / (hours || km)) * 100) / 100 });
    });
  }
  // one vehicle burning extra diesel
  trips.push({ date: today, vehicleId: V[3].id, vehicleName: V[3].name, driverName: drivers[1], work: 'Block shifting', hours: 5, km: 0, dieselLitres: 38, dieselAmount: 38 * 92, dieselPerUnit: 7.6 });
  await ins('vehicletrips', trips);

  // ---------------- PAPERS ----------------
  const docp = (name, category, expiryDate, note = '') => ({ name, category, expiryDate, note, file: IMG });
  await ins('documents', [
    docp('GST certificate', 'Company', ''), docp('PAN card – Vipul Stone Suppliers', 'Company', ''), docp('Partnership deed', 'Company', ''),
    docp('Mining lease – Bijoliya', 'Licence', addDays(today, 540), 'Lease no. ML/BHL/2021'), docp('Pollution consent (CTO)', 'Licence', addDays(today, 7), 'Renewal application pending'),
    docp('Factory licence', 'Licence', addDays(today, 45)), docp('AMC – Gang saw 1–3', 'Machine', addDays(today, 22)),
    docp('Factory fire & burglary insurance', 'Insurance', addDays(today, 200)), docp('Godown rent agreement', 'Agreement', addDays(today, 330)), docp('Term loan sanction letter', 'Loan', ''),
  ]);

  // ---------------- SAFETY ----------------
  const safety = [];
  E.filter((e) => ['Gang saw operator', 'Block cutter operator', 'Polisher', 'Loader'].includes(e.job)).slice(0, 10).forEach((e, i) => safety.push({ kind: 'gear', date: addDays(today, -ri(5, 60)), empCode: e.empCode, empName: e.name, item: pick(['Mask', 'Helmet', 'Safety shoes', 'Gloves', 'Ear plugs']), signature: 'Thumb on phone' }));
  safety.push({ kind: 'accident', date: addDays(today, -12), empCode: byJob('Loader')[2].empCode, empName: byJob('Loader')[2].name, where: 'Yard', what: 'Slab slipped, minor finger injury', firstAid: 'First aid given, dressing', action: 'Gloves and lifting clamps mandatory', severity: 'Minor', photo: IMG });
  safety.push({ kind: 'accident', date: addDays(today, -25), empCode: byJob('Polisher')[2].empCode, empName: byJob('Polisher')[2].name, where: 'Polishing line', what: 'Near-miss: loose cable on wet floor', firstAid: '-', action: 'Cable tray fitted', severity: 'Near-miss' });
  ['Gang saw 1', 'Crane 1', 'Polishing line 1', 'Loader 1'].forEach((m, i) => safety.push({ kind: 'training', date: addDays(today, -20 - i * 9), empCode: ops[m]?.empCode, empName: ops[m]?.name, topic: `${m} safe operation`, machine: m }));
  [3, 12, 40].forEach((d, i) => safety.push({ kind: 'checkup', date: addDays(today, -300), dueDate: addDays(today, d - 10 + i), empCode: E[10 + i].empCode, empName: E[10 + i].name, note: 'Annual stone-dust (silicosis) check-up' }));
  await ins('safetyrecords', safety);

  // ---------------- ADVANCES / LEAVES / REMARKS ----------------
  const advEmps = [E[13], E[22], E[30], E[35], E[40]];
  await ins('advances', advEmps.map((e, i) => ({ empCode: e.empCode, empName: e.name, amount: [10000, 5000, 20000, 8000, 3000][i], date: addDays(today, -20 - i * 5), monthlyDeduction: [2000, 1000, 4000, 2000, 1000][i], recovered: [2000, 0, 4000, 0, 1000][i], reason: 'Family need', status: 'approved' })));
  await ins('leaves', [{ empCode: E[15].empCode, empName: E[15].name, from: addDays(today, -12), to: addDays(today, -10), reason: 'Wedding', status: 'approved' }]);
  const prevM = monthOf(prevMonthStart);
  await ins('perfremarks', [{ month: prevM, empCode: 'E001', remark: 'Good output, no breakdowns.' }, { month: prevM, empCode: E[10].empCode, remark: 'Needs improvement in attendance.' }]);

  // ---------------- COUNTERS & AUDIT ----------------
  await MODELS.counters.insertMany([
    { _id: 'block', seq: 250 }, { _id: 'sale', seq: 10 }, { _id: 'gatepass', seq: gp }, { _id: 'complaint', seq: 4 }, { _id: 'emp', seq: 45 }, { _id: 'invoice-26-27', seq: invSeq },
  ]);
  await MODELS.auditlogs.create({ model: 'system', refId: 'seed', action: 'seed', by: seedBy, role: 'system', label: `Demo data loaded for ${today}`, status: 'active' });

  return {
    today, employees: E.length, machines: M.length, customers: C.length, sales: saleDocs.length, blocks: blocks.length,
    attendance: att.length, dailyReports: reps.length, machineEntries: entries.length,
  };
}
