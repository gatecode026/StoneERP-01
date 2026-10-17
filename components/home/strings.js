'use client';
import { useApp } from '@/components/Providers';

// Home-screen text, English + Hindi side by side. (Phase 6 moves every dictionary into messages/*.json.)
export const H = {
  more: { en: 'more', hi: 'और' }, trips: { en: 'trips', hi: 'फेरे' }, orders: { en: 'orders', hi: 'ऑर्डर' }, entries: { en: 'entries', hi: 'एंट्री' },
  today: { en: 'Today', hi: 'आज' }, yesterday: { en: 'vs yesterday', hi: 'कल से' },
  attendance: { en: 'Attendance', hi: 'हाज़िरी' }, present: { en: 'present', hi: 'उपस्थित' }, absent: { en: 'absent', hi: 'अनुपस्थित' }, leave: { en: 'on leave', hi: 'छुट्टी' }, notMarked: { en: 'not marked', hi: 'बाकी' },
  reports: { en: 'Daily work reports', hi: 'दैनिक कार्य रिपोर्ट' }, filled: { en: 'filled', hi: 'भरी' }, missing: { en: 'missing', hi: 'बाकी' }, problems: { en: 'Problems raised today', hi: 'आज उठी दिक्कतें' },
  machines: { en: 'Machine output', hi: 'मशीन उत्पादन' }, idle: { en: 'idle', hi: 'बंद' }, breakdowns: { en: 'Breakdowns', hi: 'ख़राबी' }, allRunning: { en: 'All running', hi: 'सब चालू' },
  stock: { en: 'Stock', hi: 'स्टॉक' }, lowStock: { en: 'Below minimum', hi: 'न्यूनतम से कम' }, mainItems: { en: 'Main items in hand', hi: 'मुख्य स्टॉक' }, allAbove: { en: 'All above minimum', hi: 'सब न्यूनतम से ऊपर' },
  sales: { en: 'Sales', hi: 'बिक्री' }, trucks: { en: 'trucks out', hi: 'ट्रक गए' }, received: { en: 'Received', hi: 'प्राप्त' }, pending: { en: 'Pending from customers', hi: 'ग्राहकों से बाकी' },
  expenses: { en: 'Expenses', hi: 'खर्चे' }, byHead: { en: 'Expenses by head', hi: 'मद के अनुसार खर्च' }, cash: { en: 'Cash in hand', hi: 'हाथ में नकद' }, bank: { en: 'Bank', hi: 'बैंक' },
  closingOk: { en: 'Closing confirmed', hi: 'क्लोजिंग हो गई' }, closingNo: { en: 'Closing not yet confirmed', hi: 'क्लोजिंग बाकी' },
  approvals: { en: 'Waiting for your approval', hi: 'मंज़ूरी बाकी' }, approve: { en: 'Approve', hi: 'मंज़ूर' }, reject: { en: 'Reject', hi: 'अस्वीकार' }, approveSel: { en: 'Approve selected', hi: 'चुने हुए मंज़ूर करें' }, selectAll: { en: 'Select all', hi: 'सब चुनें' },
  needsOwner: { en: 'Needs Owner', hi: 'मालिक की मंज़ूरी चाहिए' }, nothingWaiting: { en: 'Nothing waiting for approval', hi: 'कोई मंज़ूरी बाकी नहीं' },
  alerts: { en: 'Alerts', hi: 'चेतावनी' }, noAlerts: { en: 'No urgent alerts', hi: 'कोई ज़रूरी चेतावनी नहीं' }, all: { en: 'All', hi: 'सभी' },
  profit: { en: 'Profit', hi: 'मुनाफ़ा' }, profitOrders: { en: 'Profit per order', hi: 'ऑर्डर के अनुसार मुनाफ़ा' }, profitBlocks: { en: 'Profit per block', hi: 'ब्लॉक के अनुसार मुनाफ़ा' }, margin: { en: 'margin', hi: 'मार्जिन' }, last30: { en: 'last 30 days', hi: 'पिछले 30 दिन' },
  trend: { en: 'Machine output – last 7 days (sq ft)', hi: 'मशीन उत्पादन – पिछले 7 दिन (sq ft)' },
  noPermission: { en: 'You do not have access to this', hi: 'आपको इसकी अनुमति नहीं है' }, nothingYet: { en: 'Nothing here yet', hi: 'अभी कुछ नहीं' }, retry: { en: 'Try again', hi: 'फिर कोशिश करें' }, loadFail: { en: 'Could not load this screen', hi: 'यह स्क्रीन लोड नहीं हो सकी' },
  // manager
  opsBoard: { en: "Today's operations", hi: 'आज का संचालन' }, noEntry: { en: 'Machines with no entry yet', hi: 'जिन मशीनों की एंट्री बाकी है' }, toCheck: { en: 'Reports to check', hi: 'जाँचने वाली रिपोर्ट' }, overdue: { en: 'Overdue tasks', hi: 'देर वाले काम' }, escalate: { en: 'Above your limit – escalate to Owner', hi: 'आपकी सीमा से ऊपर – मालिक को भेजें' },
  // accountant
  ageing: { en: 'Receivables by age (days)', hi: 'बकाया – दिनों के अनुसार' }, payables: { en: 'Payable this week', hi: 'इस हफ़्ते देना है' }, unbilled: { en: 'Orders without GST bill', hi: 'बिना जीएसटी बिल के ऑर्डर' }, noEway: { en: 'Trucks sent without e-way bill (7 days)', hi: 'बिना ई-वे बिल गए ट्रक (7 दिन)' },
  salarySheet: { en: 'Salary sheet', hi: 'वेतन शीट' }, closeMonth: { en: 'Month-close checklist', hi: 'महीना बंद करने की सूची' }, exports: { en: 'Reports & exports', hi: 'रिपोर्ट और एक्सपोर्ट' }, topOwing: { en: 'Customers owing most', hi: 'सबसे ज़्यादा बकाया' },
  // supervisor
  team: { en: 'My team – attendance', hi: 'मेरी टीम – हाज़िरी' }, markAll: { en: 'Mark all present', hi: 'सबको उपस्थित करें' }, P: { en: 'P', hi: 'उ' }, A: { en: 'A', hi: 'अ' }, half: { en: '½', hi: '½' }, OT: { en: 'OT', hi: 'ओटी' }, L: { en: 'L', hi: 'छु' },
  teamOutput: { en: "Team's output today", hi: 'टीम का आज का उत्पादन' }, safetyDue: { en: 'Safety items due', hi: 'सुरक्षा के बाकी काम' }, tasks: { en: 'Tasks', hi: 'काम' }, openRepairs: { en: 'Open repairs', hi: 'खुली मरम्मत' },
  ok: { en: 'OK', hi: 'ठीक' }, notOk: { en: 'Not OK', hi: 'ठीक नहीं' },
  // salesperson
  myToday: { en: 'My sales today', hi: 'आज की मेरी बिक्री' }, myMonth: { en: 'My sales this month', hi: 'इस महीने की मेरी बिक्री' }, openQuotes: { en: 'My open quotations & orders', hi: 'मेरे खुले कोटेशन और ऑर्डर' }, owing: { en: 'My customers who owe money', hi: 'मेरे ग्राहक जिनका बकाया है' }, newQuote: { en: 'New quotation', hi: 'नया कोटेशन' }, searchStock: { en: 'Search stock (size, finish)…', hi: 'स्टॉक खोजें (साइज़, फ़िनिश)…' }, myComplaints: { en: 'My open complaints', hi: 'मेरी खुली शिकायतें' }, days: { en: 'days', hi: 'दिन' }, remind: { en: 'Remind', hi: 'याद दिलाएँ' },
  // worker
  hello: { en: 'Namaste', hi: 'नमस्ते' }, markAtt: { en: 'Mark attendance', hi: 'हाज़िरी लगाएँ' }, myAtt: { en: 'My attendance', hi: 'मेरी हाज़िरी' }, attPending: { en: 'Not marked yet today', hi: 'आज की हाज़िरी अभी नहीं लगी' }, viewAtt: { en: 'See this month', hi: 'इस महीने की हाज़िरी देखें' }, punchIn: { en: 'Punch In', hi: 'पंच इन' }, punchOut: { en: 'Punch Out', hi: 'पंच आउट' }, writeReport: { en: "Write today's report", hi: 'आज की रिपोर्ट लिखें' }, mySlip: { en: 'My salary slip', hi: 'मेरी वेतन पर्ची' }, myTasks: { en: 'My tasks', hi: 'मेरे काम' }, marked: { en: 'Marked', hi: 'लग गई' }, submitted: { en: 'Submitted', hi: 'जमा हो गई' }, takeSelfie: { en: 'Take selfie', hi: 'सेल्फी लें' }, viewEdit: { en: 'View / edit', hi: 'देखें / बदलें' }, notFilled: { en: "You have not filled today's report.", hi: 'आपने आज की रिपोर्ट नहीं भरी।' }, noTasks: { en: 'No pending tasks', hi: 'कोई काम बाकी नहीं' },
  // presets
  gate: { en: 'Trucks waiting at the gate', hi: 'गेट पर खड़े ट्रक' }, markOut: { en: 'Mark truck OUT', hi: 'ट्रक बाहर करें' }, outToday: { en: 'Out today', hi: 'आज बाहर' }, inToday: { en: 'Trucks in today', hi: 'आज आए ट्रक' }, gatePass: { en: 'Gate pass', hi: 'गेट पास' },
  store: { en: 'Stock to refill', hi: 'भरने वाला स्टॉक' }, pendingDamage: { en: 'Damage awaiting approval', hi: 'मंज़ूरी बाकी – टूट-फूट' }, moveToday: { en: 'Movements today', hi: 'आज की आवाजाही' }, newMove: { en: 'New stock entry', hi: 'नई स्टॉक एंट्री' },
  workshop: { en: 'Open breakdowns & repairs', hi: 'खुली ख़राबी और मरम्मत' }, serviceDue: { en: 'Service due', hi: 'सर्विस बाकी' },
  till: { en: 'Cash drawer', hi: 'कैश दराज़' }, countClose: { en: 'Count & confirm closing cash', hi: 'गिनें और क्लोजिंग कैश पक्का करें' }, todayEntries: { en: "Today's entries", hi: 'आज की एंट्री' },
  drive: { en: 'My trips today', hi: 'आज के मेरे चक्कर' }, dieselMonth: { en: 'Diesel this month', hi: 'इस महीने का डीज़ल' }, newTrip: { en: 'Add trip & diesel', hi: 'चक्कर और डीज़ल जोड़ें' }, vehiclePapers: { en: 'Vehicle papers', hi: 'गाड़ी के कागज़ात' },
  yard: { en: 'Blocks in yard', hi: 'यार्ड में ब्लॉक' }, newBlock: { en: 'New block', hi: 'नया ब्लॉक' }, trucksIn: { en: 'Trucks in today', hi: 'आज आए ट्रक' },
};

export function useH() {
  const { lang } = useApp();
  return (k) => H[k]?.[lang] ?? H[k]?.en ?? k;
}
