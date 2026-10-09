import {
  LayoutDashboard, Users, ClipboardList, CalendarCheck, Wallet, ShieldCheck, Trophy, Cog, Boxes, Percent, Wrench, Truck,
  Package, ShoppingCart, Receipt, PackageCheck, MessageSquareWarning, IndianRupee, BookOpen, ListChecks, FileText, History, Gem,
} from 'lucide-react';

// key doubles as the permission key and the i18n key
export const NAV_GROUPS = [
  { key: 'g_people', items: [
    { key: 'employees', href: '/employees', icon: Users, part: 1 },
    { key: 'dailyReport', href: '/daily-report', icon: ClipboardList, part: 2, perm: 'dailyreports' },
    { key: 'attendance', href: '/attendance', icon: CalendarCheck, part: 7 },
    { key: 'salary', href: '/salary', icon: Wallet, part: 7 },
    { key: 'safety', href: '/safety', icon: ShieldCheck, part: 19 },
    { key: 'performance', href: '/performance', icon: Trophy, part: 20 },
  ] },
  { key: 'g_production', items: [
    { key: 'machines', href: '/machines', icon: Cog, part: 3 },
    { key: 'blocks', href: '/blocks', icon: Boxes, part: 10 },
    { key: 'yield', href: '/yield', icon: Percent, part: 11 },
    { key: 'repairs', href: '/repairs', icon: Wrench, part: 13 },
    { key: 'vehicles', href: '/vehicles', icon: Truck, part: 17 },
  ] },
  { key: 'g_stock', items: [
    { key: 'stock', href: '/stock', icon: Package, part: 4 },
    { key: 'purchases', href: '/purchases', icon: ShoppingCart, part: 9 },
  ] },
  { key: 'g_selling', items: [
    { key: 'sales', href: '/sales', icon: Receipt, part: 5 },
    { key: 'dispatch', href: '/dispatch', icon: PackageCheck, part: 12 },
    { key: 'complaints', href: '/complaints', icon: MessageSquareWarning, part: 16 },
  ] },
  { key: 'g_money', items: [
    { key: 'expenses', href: '/expenses', icon: IndianRupee, part: 6 },
    { key: 'cash', href: '/cash', icon: BookOpen, part: 14 },
    { key: 'tasks', href: '/tasks', icon: ListChecks, part: 15, perm: 'tasks' },
    { key: 'papers', href: '/papers', icon: FileText, part: 18 },
    { key: 'audit', href: '/audit', icon: History },
  ] },
];

export const DASH = { key: 'dashboard', href: '/', icon: LayoutDashboard };

// bottom bar tabs (the 5th tab is always "More")
export const BOTTOM_TABS = {
  default: ['dashboard', 'dailyReport', 'machines', 'sales'],
  owner: ['dashboard', 'dailyReport', 'machines', 'sales'],
  manager: ['dashboard', 'dailyReport', 'machines', 'sales'],
  accountant: ['dashboard', 'sales', 'expenses', 'cash'],
  supervisor: ['dashboard', 'attendance', 'dailyReport', 'machines'],
  salesperson: ['dashboard', 'sales', 'stock', 'dispatch'],
  worker: ['dashboard', 'dailyReport', 'attendance', 'salary'],
};

export const ALL_ITEMS = [DASH, ...NAV_GROUPS.flatMap((g) => g.items)];

// FAB quick-add menu
export const QUICK_ADD = [
  { key: 'dailyReport', href: '/daily-report?new=1', icon: ClipboardList },
  { key: 'machines', href: '/machines?new=1', icon: Cog },
  { key: 'sales', href: '/sales/new', icon: Receipt },
  { key: 'expenses', href: '/expenses?new=1', icon: IndianRupee },
  { key: 'attendance', href: '/attendance', icon: CalendarCheck },
];
