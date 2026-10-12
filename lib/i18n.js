// Simple English / Hindi dictionary. Falls back to English, then to the key.
export const DICT = {
  en: {
    appName: 'Vipul Stone Suppliers', demo: 'Demo',
    dashboard: 'Dashboard', home: 'Home', more: 'More', menu: 'Menu',
    g_people: 'People', g_production: 'Production', g_stock: 'Stock & Buying', g_selling: 'Selling', g_money: 'Money & Control', g_admin: 'Admin', users: 'Users', roles: 'Roles & permissions',
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
    netSalary: 'Net salary', approveSheet: 'Approve salary sheet', slip: 'Salary slip', quickAdd: 'Quick add',
  },
  hi: {
    appName: 'विपुल स्टोन सप्लायर्स', demo: 'डेमो',
    dashboard: 'डैशबोर्ड', home: 'होम', more: 'और', menu: 'मेनू',
    g_people: 'लोग', g_production: 'उत्पादन', g_stock: 'स्टॉक और खरीद', g_selling: 'बिक्री', g_money: 'पैसा और नियंत्रण', g_admin: 'एडमिन', users: 'यूज़र', roles: 'रोल और अनुमतियाँ',
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
    netSalary: 'शुद्ध वेतन', approveSheet: 'वेतन शीट मंज़ूर करें', slip: 'वेतन पर्ची', quickAdd: 'तुरंत जोड़ें',
  },
};

export function translate(lang, key) {
  return DICT[lang]?.[key] ?? DICT.en[key] ?? key;
}
