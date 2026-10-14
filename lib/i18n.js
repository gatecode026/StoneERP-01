// Simple English / Hindi dictionary. Falls back to English, then to the key.
export const DICT = {
  en: {
    appName: 'Vipul Stone Suppliers', demo: 'Demo',
    dashboard: 'Dashboard', home: 'Home', more: 'More', menu: 'Menu',
    g_people: 'People', g_production: 'Production', g_stock: 'Stock & Buying', g_selling: 'Selling', g_money: 'Money & Control', g_admin: 'Admin', users: 'Users', roles: 'Roles & permissions', settings: 'Settings',
    employees: 'Employees', dailyReport: 'Daily Work Report', attendance: 'Attendance', salary: 'Salary', safety: 'Safety', performance: 'Performance',
    machines: 'Machine Work', blocks: 'Block Entry', yield: 'Yield & Cost', repairs: 'Machine Repair', vehicles: 'Vehicles & Loaders',
    stock: 'Stock', purchases: 'Purchases', sales: 'Sales & Payments', dispatch: 'Dispatch & Gate Pass', complaints: 'Complaints',
    expenses: 'Expenses', cash: 'Cash Book', tasks: 'Tasks & Reminders', papers: 'Important Papers', audit: 'Audit Trail',
    ownerReport: "Owner's Daily Report", shareWA: 'Share on WhatsApp', approvals: 'Pending approvals', approve: 'Approve', reject: 'Reject',
    save: 'Save', submit: 'Submit', cancel: 'Cancel', add: 'Add', edit: 'Edit', close: 'Close', search: 'Search…', export: 'Excel', print: 'Print / PDF',
    loading: 'Loading…', noData: 'Nothing here yet', history: 'History', cancelEntry: 'Cancel entry', actions: 'Actions',
    present: 'Present', absent: 'Absent', leave: 'Leave', half: 'Half day', overtime: 'Overtime',
    reportsFilled: 'Reports filled', reportsMissing: 'missing', machineOutput: 'Machine output', breakdowns: 'Breakdowns', lowStock: 'Low stock',
    todaySales: "Today's sales", dispatches: 'Dispatches', received: 'Received', pending: 'Pending', cashInHand: 'Cash in hand', bank: 'Bank',
    expensesToday: "Today's expenses", logout: 'Sign out', login: 'Enter', chooseRole: 'Choose your role to start the demo',
    workDone: 'Work done today', speak: 'Speak (Hindi)', addPhoto: 'Add photo', hours: 'Hours', quantity: 'Quantity', problem: 'Problem faced', plan: 'Plan for tomorrow',
    offline: 'Offline – saved. Will send when network returns.', syncing: 'Back online – sending saved entries…',
    resetDemo: 'Reset demo data', newQuotation: 'New quotation', newEntry: 'New entry', selfie: 'Selfie attendance', markAll: 'Mark all present',
    ok: 'OK', discard: 'Discard', sendNow: 'Send now', tryAgain: 'Try again', review: 'Review', import: 'Import', importExcel: 'Import from Excel',
    pagerShowing: 'Showing {from}–{to} of {total}', prev: 'Prev', next: 'Next', prevPage: 'Previous page', nextPage: 'Next page', rowsPerPage: 'Rows per page', perPage: '{n} / page', pages: 'Pages',
    syncTitle: 'Entries waiting to sync', syncEmpty: 'Everything is sent.', syncNeeds: 'Needs attention', syncRetrying: 'Retrying ({n})', syncWaiting: 'Waiting', syncDiscardQ: 'Discard this entry? It will not be sent.',
    queueWaiting: '{n} saved entries waiting to send', queueAttention: '{n} need attention',
    impTitle: 'Import {noun} from Excel', imp1: 'Download the sheet and fill one row per record.', imp2: 'Choose the filled file (.xlsx or .csv). It is checked first — nothing is saved yet.', imp3: 'Fix any red rows in the file and choose it again, or import the good rows.',
    impTemplate: 'Download Excel template', impFile: 'Filled sheet', impChecking: 'Checking…', impRows: '{n} rows', impReady: '{n} ready', impBad: '{n} need fixing or skipped', impIgnored: 'Ignored columns', impNote: 'Rows with a problem are skipped. Records already in the app are never overwritten.', impRow: 'Row', impOk: 'OK', impFix: 'Fix', impDone: '{n} {noun} imported', impSkipped: '{n} skipped',
    netSalary: 'Net salary', approveSheet: 'Approve salary sheet', slip: 'Salary slip', quickAdd: 'Quick add',
  },
  hi: {
    appName: 'विपुल स्टोन सप्लायर्स', demo: 'डेमो',
    dashboard: 'डैशबोर्ड', home: 'होम', more: 'और', menu: 'मेनू',
    g_people: 'लोग', g_production: 'उत्पादन', g_stock: 'स्टॉक और खरीद', g_selling: 'बिक्री', g_money: 'पैसा और नियंत्रण', g_admin: 'एडमिन', users: 'यूज़र', roles: 'रोल और अनुमतियाँ', settings: 'सेटिंग',
    employees: 'कर्मचारी', dailyReport: 'दैनिक कार्य रिपोर्ट', attendance: 'हाज़िरी', salary: 'वेतन', safety: 'सुरक्षा', performance: 'कार्य-प्रदर्शन',
    machines: 'मशीन का काम', blocks: 'ब्लॉक एंट्री', yield: 'यील्ड और लागत', repairs: 'मशीन मरम्मत', vehicles: 'गाड़ी और लोडर',
    stock: 'स्टॉक', purchases: 'खरीद', sales: 'बिक्री और भुगतान', dispatch: 'डिस्पैच और गेट पास', complaints: 'शिकायतें',
    expenses: 'खर्चे', cash: 'कैश बुक', tasks: 'काम और रिमाइंडर', papers: 'ज़रूरी कागज़ात', audit: 'ऑडिट रिकॉर्ड',
    ownerReport: 'मालिक की दैनिक रिपोर्ट', shareWA: 'व्हाट्सऐप पर भेजें', approvals: 'मंज़ूरी बाकी', approve: 'मंज़ूर', reject: 'अस्वीकार',
    save: 'सेव', submit: 'जमा करें', cancel: 'रद्द', add: 'जोड़ें', edit: 'बदलें', close: 'बंद', search: 'खोजें…', export: 'एक्सेल', print: 'प्रिंट / PDF',
    loading: 'लोड हो रहा है…', noData: 'अभी कुछ नहीं है', history: 'इतिहास', cancelEntry: 'एंट्री रद्द करें', actions: 'कार्य',
    present: 'उपस्थित', absent: 'अनुपस्थित', leave: 'छुट्टी', half: 'आधा दिन', overtime: 'ओवरटाइम',
    reportsFilled: 'रिपोर्ट भरी', reportsMissing: 'बाकी', machineOutput: 'मशीन उत्पादन', breakdowns: 'ख़राबी', lowStock: 'कम स्टॉक',
    todaySales: 'आज की बिक्री', dispatches: 'डिस्पैच', received: 'प्राप्त', pending: 'बाकी', cashInHand: 'हाथ में नकद', bank: 'बैंक',
    expensesToday: 'आज का खर्च', logout: 'साइन आउट', login: 'प्रवेश', chooseRole: 'डेमो शुरू करने के लिए अपना रोल चुनें',
    workDone: 'आज का काम', speak: 'बोलकर लिखें (हिंदी)', addPhoto: 'फोटो जोड़ें', hours: 'घंटे', quantity: 'मात्रा', problem: 'दिक्कत', plan: 'कल की योजना',
    offline: 'ऑफ़लाइन – सेव हो गया। नेटवर्क आने पर भेजा जाएगा।', syncing: 'नेटवर्क वापस – सेव की गई एंट्री भेज रहे हैं…',
    resetDemo: 'डेमो डेटा रीसेट', newQuotation: 'नया कोटेशन', newEntry: 'नई एंट्री', selfie: 'सेल्फी हाज़िरी', markAll: 'सबको उपस्थित करें',
    ok: 'ठीक है', discard: 'हटाएँ', sendNow: 'अभी भेजें', tryAgain: 'फिर कोशिश करें', review: 'देखें', import: 'इम्पोर्ट', importExcel: 'एक्सेल से इम्पोर्ट',
    pagerShowing: '{total} में से {from}–{to} दिख रहे हैं', prev: 'पिछला', next: 'अगला', prevPage: 'पिछला पेज', nextPage: 'अगला पेज', rowsPerPage: 'प्रति पेज पंक्तियाँ', perPage: '{n} / पेज', pages: 'पेज',
    syncTitle: 'भेजने के लिए रुकी एंट्री', syncEmpty: 'सब भेज दिया गया है।', syncNeeds: 'ध्यान चाहिए', syncRetrying: 'फिर कोशिश ({n})', syncWaiting: 'इंतज़ार में', syncDiscardQ: 'यह एंट्री हटाएँ? यह भेजी नहीं जाएगी।',
    queueWaiting: '{n} सेव की गई एंट्री भेजने के इंतज़ार में', queueAttention: '{n} को ध्यान चाहिए',
    impTitle: 'एक्सेल से {noun} इम्पोर्ट करें', imp1: 'शीट डाउनलोड करें और हर रिकॉर्ड के लिए एक पंक्ति भरें।', imp2: 'भरी हुई फ़ाइल (.xlsx या .csv) चुनें। पहले जाँच होगी — अभी कुछ सेव नहीं होता।', imp3: 'फ़ाइल में लाल पंक्तियाँ ठीक करके फिर से चुनें, या सही पंक्तियाँ इम्पोर्ट करें।',
    impTemplate: 'एक्सेल टेम्पलेट डाउनलोड करें', impFile: 'भरी हुई शीट', impChecking: 'जाँच हो रही है…', impRows: '{n} पंक्तियाँ', impReady: '{n} तैयार', impBad: '{n} ठीक करनी हैं या छोड़ी गईं', impIgnored: 'छोड़े गए कॉलम', impNote: 'जिन पंक्तियों में गड़बड़ है वे छोड़ दी जाती हैं। ऐप में पहले से मौजूद रिकॉर्ड कभी बदले नहीं जाते।', impRow: 'पंक्ति', impOk: 'ठीक', impFix: 'सुधारें', impDone: '{n} {noun} इम्पोर्ट हुए', impSkipped: '{n} छोड़े गए',
    netSalary: 'शुद्ध वेतन', approveSheet: 'वेतन शीट मंज़ूर करें', slip: 'वेतन पर्ची', quickAdd: 'तुरंत जोड़ें',
  },
};

/** Screen text is written in English and looked up by that exact English phrase. `dict` is the Hindi dictionary (lib/hi.js) or null for English. */
export function translatePhrase(dict, en, vars) {
  const text = (dict && dict[en]) || en;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k]))) : text;
}

/** `{name}` placeholders in the text are filled from `vars`. */
export function translate(lang, key, vars) {
  const text = DICT[lang]?.[key] ?? DICT.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k]))) : text;
}
