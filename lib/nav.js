import {
  LayoutDashboard, Users, ClipboardList, CalendarCheck, Wallet, ShieldCheck, Cog, Boxes, Percent, Truck,
  Package, ShoppingCart, Receipt, PackageCheck, MessageSquareWarning, IndianRupee, BookOpen, ListChecks, FileText, History, UserCog, KeyRound, Settings as SettingsIcon, Hammer, FolderKanban,
} from 'lucide-react';

// key = i18n key. `res` = resources of which the user needs view access to see the item (any of them).
// The navigation is generated from the signed-in user's permissions, so nobody sees a link they cannot open.
export const NAV_GROUPS = [
  { key: 'g_people', items: [
    { key: 'supervisor', href: '/supervisor', icon: Hammer, part: 1, res: ['supervisor', 'tasks'], label: 'Supervisor Dashboard' },
    { key: 'projects', href: '/projects', icon: FolderKanban, part: 15, res: ['projects', 'tasks'], label: 'Projects & Work' },
    { key: 'employees', href: '/employees', icon: Users, part: 1, res: ['employees'] },
    { key: 'dailyReport', href: '/daily-report', icon: ClipboardList, part: 2, res: ['dailyreports'] },
    { key: 'attendance', href: '/attendance', icon: CalendarCheck, part: 7, res: ['attendance'] },
    { key: 'salary', href: '/salary', icon: Wallet, part: 7, res: ['salarysheets', 'salaryslips'] },
    { key: 'safety', href: '/safety', icon: ShieldCheck, part: 19, res: ['safetyrecords'] },
  ] },
  { key: 'g_production', items: [
    { key: 'machines', href: '/machines', icon: Cog, part: 3, res: ['machineentries'] },
    { key: 'blocks', href: '/blocks', icon: Boxes, part: 10, res: ['blocks'] },
    { key: 'yield', href: '/yield', icon: Percent, part: 11, res: ['yield'] },
    { key: 'vehicles', href: '/vehicles', icon: Truck, part: 17, res: ['vehicles', 'vehicletrips'] },
  ] },
  { key: 'g_stock', items: [
    { key: 'stock', href: '/stock', icon: Package, part: 4, res: ['stockitems'] },
    { key: 'purchases', href: '/purchases', icon: ShoppingCart, part: 9, res: ['purchases'] },
  ] },
  { key: 'g_selling', items: [
    { key: 'sales', href: '/sales', icon: Receipt, part: 5, res: ['sales'] },
    { key: 'dispatch', href: '/dispatch', icon: PackageCheck, part: 12, res: ['dispatches'] },
    { key: 'complaints', href: '/complaints', icon: MessageSquareWarning, part: 16, res: ['complaints'] },
  ] },
  { key: 'g_money', items: [
    { key: 'expenses', href: '/expenses', icon: IndianRupee, part: 6, res: ['expenses'] },
    { key: 'cash', href: '/cash', icon: BookOpen, part: 14, res: ['cashentries', 'accounts'] },
    { key: 'tasks', href: '/tasks', icon: ListChecks, part: 15, res: ['tasks'] },
    { key: 'papers', href: '/papers', icon: FileText, part: 18, res: ['documents'] },
    { key: 'audit', href: '/audit', icon: History, res: ['auditlogs'] },
  ] },
  { key: 'g_admin', items: [
    { key: 'roles', href: '/settings/roles', icon: KeyRound, res: ['roles'] },
    { key: 'settings', href: '/settings', icon: SettingsIcon, res: ['settings'] },
  ] },
];

export const DASH = { key: 'dashboard', href: '/', icon: LayoutDashboard, res: ['dashboard'] };

// bottom bar tabs (the 5th tab is always "More"); only tabs the user may open are shown
export const BOTTOM_TABS = {
  default: ['dashboard', 'dailyReport', 'machines', 'sales'],
  owner: ['dashboard', 'dailyReport', 'machines', 'sales'],
  manager: ['dashboard', 'dailyReport', 'machines', 'sales'],
  accountant: ['dashboard', 'sales', 'expenses', 'cash'],
  supervisor: ['dashboard', 'supervisor', 'attendance', 'dailyReport'],
  salesperson: ['dashboard', 'sales', 'stock', 'dispatch'],
  worker: ['dashboard', 'dailyReport', 'attendance', 'salary'],
  guard: ['dashboard', 'dispatch'],
  store_keeper: ['dashboard', 'stock', 'purchases'],
  yard_incharge: ['dashboard', 'blocks', 'dispatch'],
  mechanic: ['dashboard', 'machines'],
  cashier: ['dashboard', 'cash', 'expenses'],
  driver: ['dashboard', 'vehicles', 'expenses'],
};

export const ALL_ITEMS = [DASH, ...NAV_GROUPS.flatMap((g) => g.items)];

// FAB quick-add menu: shown only when the user may create that record
export const QUICK_ADD = [
  { key: 'dailyReport', href: '/daily-report?new=1', icon: ClipboardList, res: 'dailyreports' },
  { key: 'machines', href: '/machines?new=1', icon: Cog, res: 'machineentries' },
  { key: 'sales', href: '/sales/new', icon: Receipt, res: 'sales' },
  { key: 'expenses', href: '/expenses?new=1', icon: IndianRupee, res: 'expenses' },
  { key: 'attendance', href: '/attendance', icon: CalendarCheck, res: 'attendance' },
];
