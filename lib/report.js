import { inrShort, inr, num, parseISO } from './format';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso) => { const d = parseISO(iso); return `${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]}`; };

// Lines of the owner's WhatsApp report. { text, problem } — problems are shown in red / bold.
export function reportLines(d, lang = 'en') {
  const hi = lang === 'hi';
  const L = [];
  const add = (text, problem = false) => text && L.push({ text, problem });
  add(`${hi ? 'VSS दैनिक रिपोर्ट' : 'VSS daily report'} · ${dayLabel(d.date)}`, false);
  add(hi ? `हाज़िरी: ${d.attendance.present} उपस्थित, ${d.attendance.absent} अनुपस्थित${d.attendance.leave ? `, ${d.attendance.leave} छुट्टी` : ''}`
    : `Attendance: ${d.attendance.present} present, ${d.attendance.absent} absent${d.attendance.leave ? `, ${d.attendance.leave} on leave` : ''}`);
  add(hi ? `काम की रिपोर्ट: ${d.reports.filled} भरी, ${d.reports.missing} बाकी` : `Work reports: ${d.reports.filled} filled, ${d.reports.missing} missing`, d.reports.missing > 0);
  add(hi ? `मशीन: ${num(d.machines.totalSqft)} sq ft कटिंग` : `Machines: ${num(d.machines.totalSqft)} sq ft cut`);
  (d.machines.breakdowns || []).forEach((m) => {
    const h = +(m.stoppedMins / 60).toFixed(1);
    add(hi ? `${m.name} ${h} घंटे बंद (${m.breakdown ? 'मरम्मत' : m.reason})` : `${m.name} stopped ${h} hours (${m.breakdown ? 'repair' : m.reason})`, true);
  });
  if (d.stock.lowStock.length) add(`${hi ? 'कम स्टॉक' : 'Low stock'}: ${d.stock.lowStock.map((x) => x.name).join(', ')}`, true);
  if (d.sales) {
    add(hi ? `बिक्री: ${inrShort(d.sales.today)} · ${d.sales.dispatches} ट्रक भेजे` : `Sales: ${inrShort(d.sales.today)} · ${d.sales.dispatches} trucks dispatched`);
    add(`${hi ? 'प्राप्त' : 'Received'}: ${inrShort(d.sales.received)}`);
    if (d.sales.pending != null) add(`${hi ? 'ग्राहकों से बाकी' : 'Pending from customers'}: ${inrShort(d.sales.pending)}`);
  }
  if (d.expenses) {
    const diesel = d.expenses.byHead.find((h) => /diesel/i.test(h.head));
    add(`${hi ? 'खर्चे' : 'Expenses'}: ${inr(d.expenses.total)}${diesel ? ` (${hi ? 'डीज़ल' : 'diesel'} ${inr(diesel.amount)})` : ''}`);
  }
  if (d.cash) add(`${hi ? 'हाथ में नकद' : 'Cash in hand'}: ${inr(d.cash.inHand)}${hi ? ' · बैंक ' : ' · Bank '}${inrShort(d.cash.bank)}`);
  if (d.approvals?.length) add(hi ? `${d.approvals.length} मंज़ूरी बाकी — ऐप खोलें` : `${d.approvals.length} approvals waiting — open app`, true);
  return L;
}

export const reportText = (d, lang) => reportLines(d, lang).map((l) => (l.problem ? `*${l.text}*` : l.text)).join('\n');
