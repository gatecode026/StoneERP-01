/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  Project, StockItem, Employee, DailyReport, Attendance, Machine, MachineEntry,
  Block, Purchase, Sale, Dispatch, Customer, Supplier, Expense, CashEntry,
  Task, SafetyRecord, Vehicle, Repair, Complaint, PaperDoc,
} from '@/lib/models';
import { CSV_BOM, csvCell, csvLine } from './csv';
import { PdfBuilder } from './pdf';
import { todayIST } from '@/lib/time';

export type SectionCol = {
  key: string;
  label: string;
  w?: number; // width hint for PDF / Excel
};

export type SectionMeta = {
  id: string;
  name: string;
  group: string;
  icon: string;
  description: string;
  importFormatNote: string;
  model: any;
  columns: SectionCol[];
  mapDoc: (doc: any) => Record<string, any>;
};

export const BACKUP_SECTIONS: SectionMeta[] = [
  {
    id: 'projects',
    name: 'Projects & Work Orders',
    group: 'Operations & Production',
    icon: 'FolderKanban',
    description: 'Stone architectural projects, order details, color, sizes, finishes, quantities, and pricing.',
    importFormatNote: 'Matches Projects Import template (ordDate, orderNo, partyName, place, state, country...)',
    model: Project,
    columns: [
      { key: 'ordDate', label: 'Ord. Date', w: 12 },
      { key: 'orderNo', label: 'Order No', w: 12 },
      { key: 'partyName', label: 'Party Name', w: 20 },
      { key: 'place', label: 'Place', w: 14 },
      { key: 'state', label: 'State', w: 14 },
      { key: 'country', label: 'Country', w: 12 },
      { key: 'ourSaleInvoice', label: 'Our Sale Invoice', w: 14 },
      { key: 'partyPoNo', label: 'Party P.O. No', w: 14 },
      { key: 'colour', label: 'Colour', w: 18 },
      { key: 'finish', label: 'Finish', w: 14 },
      { key: 'edges', label: 'Edges', w: 14 },
      { key: 'sizes', label: 'Sizes', w: 14 },
      { key: 'thickness', label: 'Thickness', w: 12 },
      { key: 'qtyInPcs', label: 'Qty In Pcs', w: 10 },
      { key: 'completedPcs', label: 'Completed Pcs', w: 10 },
      { key: 'balancePcs', label: 'Balance Pcs', w: 10 },
      { key: 'qtyInSqFt', label: 'Qty In Sq Ft', w: 12 },
      { key: 'qtyInTons', label: 'Qty In Tons', w: 12 },
      { key: 'units', label: 'Units', w: 10 },
      { key: 'dispatchQty', label: 'Dispatch Qty', w: 12 },
      { key: 'price', label: 'Price', w: 10 },
      { key: 'totalOrderAmount', label: 'Total Order Amount', w: 14 },
      { key: 'balanceOrderQty', label: 'Balance Order Qty', w: 12 },
      { key: 'balanceOrderAmount', label: 'Balance Order Amount', w: 14 },
      { key: 'otherRemark', label: 'Other Remark', w: 22 },
    ],
    mapDoc: (d) => ({
      ordDate: d.startDate || '',
      orderNo: d.orderNo || '',
      partyName: d.clientName || d.name || '',
      place: d.place || d.site || '',
      state: d.state || 'Rajasthan',
      country: d.country || 'India',
      ourSaleInvoice: d.ourSaleInvoice || '',
      partyPoNo: d.partyPoNo || '',
      colour: d.stoneType || '',
      finish: d.finish || '',
      edges: d.edges || '',
      sizes: d.sizes || '',
      thickness: d.thickness || '',
      qtyInPcs: d.qtyInPcs ?? '',
      completedPcs: d.completedPcs ?? '',
      balancePcs: d.balancePcs ?? '',
      qtyInSqFt: d.qtyInSqFt ?? '',
      qtyInTons: d.qtyInTons ?? '',
      units: d.units || 'Sq Ft',
      dispatchQty: d.dispatchQty ?? '',
      price: d.price ?? '',
      totalOrderAmount: d.contractValue || ((d.price && d.qtyInSqFt) ? d.price * d.qtyInSqFt : ''),
      balanceOrderQty: d.balanceOrderQty ?? '',
      balanceOrderAmount: d.balanceOrderAmount ?? '',
      otherRemark: d.otherRemark || d.notes || '',
    }),
  },
  {
    id: 'stockitems',
    name: 'Stock & Inventory Items',
    group: 'Inventory & Materials',
    icon: 'Package',
    description: 'Stone varieties, surface finishes, cut edges, thickness, dimensions, pieces, and current SQFT balance.',
    importFormatNote: 'Matches Stock Import template (Name, Finish, Egdes, Thikness, Size (L), Size (W), Quntity, SQFT, Price)',
    model: StockItem,
    columns: [
      { key: 'name', label: 'Name', w: 20 },
      { key: 'finish', label: 'Finish', w: 16 },
      { key: 'edges', label: 'Egdes', w: 16 },
      { key: 'thickness', label: 'Thikness', w: 14 },
      { key: 'sizeL', label: 'Size (L)', w: 12 },
      { key: 'sizeW', label: 'Size (W)', w: 12 },
      { key: 'pieces', label: 'Quntity', w: 12 },
      { key: 'balance', label: 'SQFT', w: 14 },
      { key: 'price', label: 'Price', w: 12 },
    ],
    mapDoc: (d) => ({
      name: d.name || '',
      finish: d.finish || '',
      edges: d.edges || '',
      thickness: d.thickness || '',
      sizeL: d.sizeL ?? '',
      sizeW: d.sizeW ?? '',
      pieces: d.pieces ?? 0,
      balance: d.balance ?? d.openingBalance ?? 0,
      price: d.sellRate ?? d.price ?? 0,
    }),
  },
  {
    id: 'employees',
    name: 'Employees & Staff',
    group: 'Master Data & People',
    icon: 'Users',
    description: 'Master personnel records, designations, contact numbers, biometric mappings, sites, pay structures, and banking details.',
    importFormatNote: 'Matches Employee Import template (Employee code, Name, Job, Mobile, Shift code, Biometric ID, Site, Joining date...)',
    model: Employee,
    columns: [
      { key: 'empCode', label: 'Employee code', w: 14 },
      { key: 'name', label: 'Name', w: 20 },
      { key: 'job', label: 'Job', w: 16 },
      { key: 'mobile', label: 'Mobile', w: 14 },
      { key: 'shiftId', label: 'Shift code', w: 12 },
      { key: 'biometricId', label: 'Biometric ID', w: 14 },
      { key: 'site', label: 'Site', w: 14 },
      { key: 'joiningDate', label: 'Joining date', w: 14 },
      { key: 'payType', label: 'Pay type', w: 12 },
      { key: 'rate', label: 'Pay rate', w: 12 },
      { key: 'pieceUnit', label: 'Piece unit', w: 12 },
      { key: 'fatherName', label: "Father's name", w: 18 },
      { key: 'address', label: 'Address', w: 24 },
      { key: 'bankAccount', label: 'Bank account', w: 18 },
      { key: 'ifsc', label: 'IFSC code', w: 14 },
      { key: 'upi', label: 'UPI', w: 16 },
      { key: 'aadhaarNo', label: 'Aadhaar number', w: 16 },
      { key: 'panNo', label: 'PAN', w: 14 },
      { key: 'pfApplicable', label: 'PF applicable', w: 12 },
      { key: 'pfNo', label: 'PF number', w: 14 },
      { key: 'esiApplicable', label: 'ESI applicable', w: 12 },
    ],
    mapDoc: (d) => ({
      empCode: d.empCode || '',
      name: d.name || '',
      job: d.job || '',
      mobile: d.mobile || '',
      shiftId: d.shiftId || '',
      biometricId: d.biometricId || '',
      site: d.site || 'Factory',
      joiningDate: d.joiningDate || '',
      payType: d.payType || 'monthly',
      rate: d.rate ?? '',
      pieceUnit: d.pieceUnit || '',
      fatherName: d.fatherName || '',
      address: d.address || '',
      bankAccount: d.bankAccount || '',
      ifsc: d.ifsc || '',
      upi: d.upi || '',
      aadhaarNo: d.aadhaarNo || '',
      panNo: d.panNo || '',
      pfApplicable: d.pfApplicable ? 'Yes' : 'No',
      pfNo: d.pfNo || '',
      esiApplicable: d.esiApplicable ? 'Yes' : 'No',
    }),
  },
  {
    id: 'dailyreports',
    name: 'Daily Work Reports',
    group: 'Operations & Production',
    icon: 'ClipboardList',
    description: 'Daily operator and supervisor logs, machine production, stone cutting output, hours, and notes.',
    importFormatNote: 'Matches Daily Work Report Import template (Date, Employee, Narration, Hours, Quantity...)',
    model: DailyReport,
    columns: [
      { key: 'date', label: 'Date', w: 12 },
      { key: 'empCode', label: 'Employee', w: 14 },
      { key: 'narration', label: 'Narration', w: 26 },
      { key: 'hours', label: 'Hours', w: 10 },
      { key: 'quantity', label: 'Quantity', w: 12 },
      { key: 'problem', label: 'Problem', w: 18 },
      { key: 'plan', label: 'Plan', w: 18 },
      { key: 'machineName', label: 'Machine', w: 18 },
      { key: 'colour', label: 'Colour', w: 16 },
      { key: 'output', label: 'Output', w: 16 },
      { key: 'thickness', label: 'Thickness', w: 12 },
      { key: 'edges', label: 'Edges', w: 14 },
      { key: 'pieces', label: 'Pieces', w: 10 },
      { key: 'rate', label: 'Rate', w: 10 },
    ],
    mapDoc: (d) => ({
      date: d.date || '',
      empCode: d.empCode || '',
      narration: d.narration || '',
      hours: d.hours ?? '',
      quantity: d.quantity ?? '',
      problem: d.problem || '',
      plan: d.plan || '',
      machineName: d.machineNames || d.machineName || '',
      colour: d.colour || '',
      output: d.output || '',
      thickness: d.thickness ?? '',
      edges: d.edges || '',
      pieces: d.pieces ?? '',
      rate: d.rate ?? '',
    }),
  },
  {
    id: 'attendance',
    name: 'Staff Attendance',
    group: 'Master Data & People',
    icon: 'CalendarCheck',
    description: 'Daily muster rolls, punch records, present/absent status, shift in/out times, and supervisor remarks.',
    importFormatNote: 'Matches Attendance Import template (Date, Employee, State, In time, Out time, Remark)',
    model: Attendance,
    columns: [
      { key: 'date', label: 'Date', w: 12 },
      { key: 'empCode', label: 'Employee', w: 14 },
      { key: 'state', label: 'State', w: 12 },
      { key: 'inTime', label: 'In time', w: 12 },
      { key: 'outTime', label: 'Out time', w: 12 },
      { key: 'remark', label: 'Remark', w: 22 },
    ],
    mapDoc: (d) => ({
      date: d.date || '',
      empCode: d.empCode || '',
      state: d.state || 'present',
      inTime: d.inTime || '',
      outTime: d.outTime || '',
      remark: d.remark || '',
    }),
  },
  {
    id: 'customers',
    name: 'Customers & Parties',
    group: 'Commercial & Sales',
    icon: 'Users',
    description: 'Clients, builders, architects, contact details, GST numbers, and delivery addresses.',
    importFormatNote: 'Matches Customer Import template (Customer name, Mobile, GST number, Address, City, State, Country, Type)',
    model: Customer,
    columns: [
      { key: 'name', label: 'Customer name', w: 22 },
      { key: 'mobile', label: 'Mobile', w: 14 },
      { key: 'gstin', label: 'GST number', w: 16 },
      { key: 'address', label: 'Address', w: 24 },
      { key: 'city', label: 'City', w: 14 },
      { key: 'state', label: 'State', w: 14 },
      { key: 'country', label: 'Country', w: 14 },
      { key: 'type', label: 'Type', w: 12 },
    ],
    mapDoc: (d) => ({
      name: d.name || '',
      mobile: d.mobile || '',
      gstin: d.gstin || '',
      address: d.address || '',
      city: d.city || '',
      state: d.state || '',
      country: d.country || 'India',
      type: d.type || 'Domestic',
    }),
  },
  {
    id: 'suppliers',
    name: 'Suppliers & Vendors',
    group: 'Inventory & Materials',
    icon: 'ShoppingCart',
    description: 'Quarries, block vendors, blade and consumable suppliers, contact numbers, and supplies list.',
    importFormatNote: 'Matches Supplier Import template (Supplier name, Mobile, GST number, City, Supplies)',
    model: Supplier,
    columns: [
      { key: 'name', label: 'Supplier name', w: 22 },
      { key: 'mobile', label: 'Mobile', w: 14 },
      { key: 'gstin', label: 'GST number', w: 16 },
      { key: 'city', label: 'City', w: 14 },
      { key: 'supplies', label: 'Supplies', w: 20 },
    ],
    mapDoc: (d) => ({
      name: d.name || '',
      mobile: d.mobile || '',
      gstin: d.gstin || '',
      city: d.city || '',
      supplies: d.supplies || '',
    }),
  },
  {
    id: 'purchases',
    name: 'Purchases & Inward Goods',
    group: 'Inventory & Materials',
    icon: 'Receipt',
    description: 'Inward material bills, block purchases, consumables, bill numbers, quantities, rates, and GST breakdown.',
    importFormatNote: 'Matches Purchases Import template (Date, Party Name, Product Name, Bill Number, HSN, Qty, Unit, Rate...)',
    model: Purchase,
    columns: [
      { key: 'date', label: 'Date', w: 12 },
      { key: 'partyName', label: 'Party Name', w: 20 },
      { key: 'productName', label: 'Product Name', w: 20 },
      { key: 'billNo', label: 'Bill Number', w: 14 },
      { key: 'hsn', label: 'HSN', w: 12 },
      { key: 'qty', label: 'Qty', w: 10 },
      { key: 'unit', label: 'Unit', w: 10 },
      { key: 'rate', label: 'Rate', w: 10 },
      { key: 'discountPct', label: 'Discount %', w: 10 },
      { key: 'gstPct', label: 'GST %', w: 10 },
      { key: 'paidAmount', label: 'Paid Amount', w: 12 },
    ],
    mapDoc: (d) => ({
      date: d.date || '',
      partyName: d.partyName || d.supplierName || '',
      productName: d.productName || d.itemName || '',
      billNo: d.billNo || d.invoiceNo || '',
      hsn: d.hsn || '',
      qty: d.qty ?? '',
      unit: d.unit || '',
      rate: d.rate ?? '',
      discountPct: d.discountPct ?? '',
      gstPct: d.gstPct ?? '',
      paidAmount: d.paidAmount ?? '',
    }),
  },
  {
    id: 'sales',
    name: 'Sales Quotations & Orders',
    group: 'Commercial & Sales',
    icon: 'Receipt',
    description: 'Quotations, confirmed sales orders, stone specs, pricing, tax calculations, and status.',
    importFormatNote: 'Matches Sales Import template (Order Date, Customer, Item, Thickness, Finish, Sizes, Qty, Unit, Rate...)',
    model: Sale,
    columns: [
      { key: 'date', label: 'Order Date', w: 12 },
      { key: 'saleNo', label: 'Order No', w: 12 },
      { key: 'customerName', label: 'Customer', w: 20 },
      { key: 'itemName', label: 'Item', w: 18 },
      { key: 'thickness', label: 'Thickness', w: 12 },
      { key: 'finish', label: 'Finish', w: 14 },
      { key: 'sizes', label: 'Sizes', w: 14 },
      { key: 'qty', label: 'Qty', w: 10 },
      { key: 'unit', label: 'Unit', w: 10 },
      { key: 'rate', label: 'Rate', w: 10 },
      { key: 'gstPct', label: 'GST %', w: 10 },
      { key: 'stage', label: 'Stage', w: 12 },
    ],
    mapDoc: (d) => {
      const line = d.lines?.[0] || {};
      return {
        date: d.date || '',
        saleNo: d.saleNo || '',
        customerName: d.customerName || '',
        itemName: line.name || d.itemName || '',
        thickness: line.thickness || d.thickness || '',
        finish: line.finish || d.finish || '',
        sizes: line.sizes || d.sizes || '',
        qty: line.qty ?? d.totalSqFt ?? '',
        unit: line.unit || d.unit || 'Sq Ft',
        rate: line.rate ?? d.rate ?? '',
        gstPct: d.gstPct ?? 18,
        stage: d.stage || 'quotation',
      };
    },
  },
  {
    id: 'dispatches',
    name: 'Dispatches & Loading Slips',
    group: 'Commercial & Sales',
    icon: 'Truck',
    description: 'Truck loading slips, vehicle dispatch numbers, drivers, e-way bills, quantities, and destination.',
    importFormatNote: 'Matches Dispatch Import template (Date, Direction, Truck number, Driver name, Driver mobile, Order number...)',
    model: Dispatch,
    columns: [
      { key: 'date', label: 'Date', w: 12 },
      { key: 'direction', label: 'Direction', w: 12 },
      { key: 'truckNo', label: 'Truck number', w: 16 },
      { key: 'driverName', label: 'Driver name', w: 18 },
      { key: 'driverMobile', label: 'Driver mobile', w: 14 },
      { key: 'orderNo', label: 'Order number', w: 14 },
      { key: 'itemName', label: 'Item', w: 18 },
      { key: 'qty', label: 'Quantity', w: 12 },
      { key: 'unit', label: 'Unit', w: 10 },
      { key: 'ewayBill', label: 'E-way bill', w: 16 },
    ],
    mapDoc: (d) => {
      const line = d.items?.[0] || {};
      return {
        date: d.date || '',
        direction: d.direction || 'out',
        truckNo: d.truckNo || '',
        driverName: d.driverName || '',
        driverMobile: d.driverMobile || '',
        orderNo: d.orderNo || d.saleNo || '',
        itemName: line.name || d.itemName || '',
        qty: line.qty ?? d.qty ?? '',
        unit: line.unit || d.unit || 'Sq Ft',
        ewayBill: d.ewayBill || '',
      };
    },
  },
  {
    id: 'expenses',
    name: 'Company Expenses',
    group: 'Financials & Accounts',
    icon: 'IndianRupee',
    description: 'Daily factory and site expenses, petty cash vouchers, expense heads, approval status, and remarks.',
    importFormatNote: 'Matches Expenses Import template (Date, Head, Amount, Paid by, Paid to, Spent by employee, Site, Remark)',
    model: Expense,
    columns: [
      { key: 'date', label: 'Date', w: 12 },
      { key: 'head', label: 'Head', w: 18 },
      { key: 'amount', label: 'Amount', w: 12 },
      { key: 'paidBy', label: 'Paid by', w: 14 },
      { key: 'paidTo', label: 'Paid to', w: 18 },
      { key: 'spentByName', label: 'Spent by', w: 18 },
      { key: 'site', label: 'Site', w: 14 },
      { key: 'remark', label: 'Remark', w: 22 },
    ],
    mapDoc: (d) => ({
      date: d.date || '',
      head: d.head || '',
      amount: d.amount ?? 0,
      paidBy: d.paidBy || 'cash',
      paidTo: d.paidTo || '',
      spentByName: d.spentByName || d.spentByCode || '',
      site: d.site || 'Factory',
      remark: d.remark || '',
    }),
  },
  {
    id: 'cashentries',
    name: 'Cash Book & Bank Ledger',
    group: 'Financials & Accounts',
    icon: 'BookOpen',
    description: 'Daily cash and bank transactions, receipts, payments, ledger heads, and narrations.',
    importFormatNote: 'Matches Cash Entries Import template (Date, Account, Type, Amount, Head, Narration, Party)',
    model: CashEntry,
    columns: [
      { key: 'date', label: 'Date', w: 12 },
      { key: 'account', label: 'Account', w: 14 },
      { key: 'type', label: 'Type', w: 12 },
      { key: 'amount', label: 'Amount', w: 12 },
      { key: 'head', label: 'Head', w: 18 },
      { key: 'narration', label: 'Narration', w: 24 },
      { key: 'party', label: 'Party', w: 20 },
    ],
    mapDoc: (d) => ({
      date: d.date || '',
      account: d.account || 'Cash',
      type: d.type || 'receipt',
      amount: d.amount ?? 0,
      head: d.head || '',
      narration: d.narration || '',
      party: d.party || '',
    }),
  },
  {
    id: 'machines',
    name: 'Machinery & Equipment',
    group: 'Operations & Production',
    icon: 'Cog',
    description: 'Bridge cutters, gang saws, edge polishers, calibration units, installation dates, and sites.',
    importFormatNote: 'Matches Machines Import template (Machine name, Type, Site, Bought on, Notes)',
    model: Machine,
    columns: [
      { key: 'name', label: 'Machine name', w: 22 },
      { key: 'type', label: 'Type', w: 18 },
      { key: 'site', label: 'Site', w: 14 },
      { key: 'boughtOn', label: 'Bought on', w: 14 },
      { key: 'notes', label: 'Notes', w: 24 },
    ],
    mapDoc: (d) => ({
      name: d.name || '',
      type: d.type || '',
      site: d.site || 'Factory',
      boughtOn: d.boughtOn || '',
      notes: d.notes || '',
    }),
  },
  {
    id: 'machineentries',
    name: 'Machine Production Logs',
    group: 'Operations & Production',
    icon: 'Cog',
    description: 'Daily machine run hours, operators, shifts, output quantities, downtime, and maintenance.',
    importFormatNote: 'Matches Machine Entries Import template (Date, Machine, Operator, Shift, Hours, Units produced...)',
    model: MachineEntry,
    columns: [
      { key: 'date', label: 'Date', w: 12 },
      { key: 'machineName', label: 'Machine', w: 18 },
      { key: 'operatorCode', label: 'Operator', w: 14 },
      { key: 'shift', label: 'Shift', w: 12 },
      { key: 'hours', label: 'Hours', w: 10 },
      { key: 'unitsProduced', label: 'Units produced', w: 14 },
      { key: 'unit', label: 'Unit', w: 10 },
      { key: 'problem', label: 'Problem', w: 20 },
      { key: 'downtimeMin', label: 'Downtime (min)', w: 14 },
    ],
    mapDoc: (d) => ({
      date: d.date || '',
      machineName: d.machineName || '',
      operatorCode: d.operatorCode || '',
      shift: d.shift || 'day',
      hours: d.hours ?? '',
      unitsProduced: d.unitsProduced ?? '',
      unit: d.unit || 'Sq Ft',
      problem: d.problem || '',
      downtimeMin: d.downtimeMin ?? '',
    }),
  },
  {
    id: 'blocks',
    name: 'Quarry Stone Blocks',
    group: 'Operations & Production',
    icon: 'Boxes',
    description: 'Rawanna numbers, block measurements (L x W x H in inches), CFT, weight in tonnes, and cutting stage.',
    importFormatNote: 'Matches Blocks Import template (Rawanna number, Block number, Length, Width, Height, Weight, Date, Supplier...)',
    model: Block,
    columns: [
      { key: 'rawanna', label: 'Rawanna number', w: 16 },
      { key: 'blockNo', label: 'Block number', w: 14 },
      { key: 'length', label: 'Length (in)', w: 12 },
      { key: 'width', label: 'Width (in)', w: 12 },
      { key: 'height', label: 'Height (in)', w: 12 },
      { key: 'tonnes', label: 'Weight (tonnes)', w: 14 },
      { key: 'date', label: 'Date', w: 12 },
      { key: 'supplierName', label: 'Supplier', w: 18 },
      { key: 'mine', label: 'Mine', w: 16 },
      { key: 'stage', label: 'Stage', w: 12 },
    ],
    mapDoc: (d) => ({
      rawanna: d.rawanna || '',
      blockNo: d.blockNo ?? '',
      length: d.length ?? '',
      width: d.width ?? '',
      height: d.height ?? '',
      tonnes: d.tonnes ?? '',
      date: d.date || '',
      supplierName: d.supplierName || '',
      mine: d.mine || '',
      stage: d.stage || 'received',
    }),
  },
  {
    id: 'tasks',
    name: 'Work Tasks & Checklists',
    group: 'Operations & Production',
    icon: 'ListChecks',
    description: 'Internal operational tasks, assigned team members, deadlines, priority, and progress status.',
    importFormatNote: 'Matches Tasks Import template (Title, Due date, Priority, Assignee, Status, Notes)',
    model: Task,
    columns: [
      { key: 'title', label: 'Title', w: 24 },
      { key: 'dueDate', label: 'Due date', w: 14 },
      { key: 'priority', label: 'Priority', w: 12 },
      { key: 'assigneeName', label: 'Assignee', w: 18 },
      { key: 'status', label: 'Status', w: 12 },
      { key: 'notes', label: 'Notes', w: 24 },
    ],
    mapDoc: (d) => ({
      title: d.title || '',
      dueDate: d.dueDate || '',
      priority: d.priority || 'Normal',
      assigneeName: d.assigneeName || d.assignedCode || '',
      status: d.status || 'open',
      notes: d.notes || '',
    }),
  },
  {
    id: 'safetyrecords',
    name: 'Health & Safety Records',
    group: 'Master Data & People',
    icon: 'ShieldCheck',
    description: 'Accident logs, safety training programs, PPE gear, health check-ups, and compliance.',
    importFormatNote: 'Matches Safety Records Import format (Date, Kind, Employee, Topic / What, Due date, Notes)',
    model: SafetyRecord,
    columns: [
      { key: 'date', label: 'Date', w: 12 },
      { key: 'kind', label: 'Kind', w: 12 },
      { key: 'empCode', label: 'Employee', w: 14 },
      { key: 'topic', label: 'Topic / What', w: 24 },
      { key: 'dueDate', label: 'Due date', w: 14 },
      { key: 'notes', label: 'Notes', w: 24 },
    ],
    mapDoc: (d) => ({
      date: d.date || '',
      kind: d.kind || 'accident',
      empCode: d.empCode || '',
      topic: d.topic || d.what || '',
      dueDate: d.dueDate || '',
      notes: d.notes || '',
    }),
  },
  {
    id: 'vehicles',
    name: 'Vehicles & Loaders',
    group: 'Operations & Production',
    icon: 'Truck',
    description: 'Trucks, tractors, cranes, loaders, registration numbers, ownership, and drivers.',
    importFormatNote: 'Matches Vehicles Import template (Vehicle name, Registration No, Kind, Ownership, Driver, Notes)',
    model: Vehicle,
    columns: [
      { key: 'name', label: 'Vehicle name', w: 20 },
      { key: 'regNo', label: 'Registration No', w: 18 },
      { key: 'kind', label: 'Kind', w: 14 },
      { key: 'ownership', label: 'Ownership', w: 14 },
      { key: 'driverName', label: 'Driver', w: 18 },
      { key: 'notes', label: 'Notes', w: 22 },
    ],
    mapDoc: (d) => ({
      name: d.name || '',
      regNo: d.regNo || '',
      kind: d.kind || 'truck',
      ownership: d.ownership || 'own',
      driverName: d.driverName || '',
      notes: d.notes || '',
    }),
  },
  {
    id: 'repairs',
    name: 'Machine Repairs & Maintenance',
    group: 'Operations & Production',
    icon: 'Hammer',
    description: 'Equipment breakdowns, maintenance logs, repair parts, costs, and resolution status.',
    importFormatNote: 'Matches Repairs Import format (Date, Machine, Kind, Problem, Status, Cost)',
    model: Repair,
    columns: [
      { key: 'date', label: 'Date', w: 12 },
      { key: 'machineName', label: 'Machine', w: 18 },
      { key: 'kind', label: 'Kind', w: 14 },
      { key: 'problem', label: 'Problem', w: 24 },
      { key: 'status', label: 'Status', w: 12 },
      { key: 'cost', label: 'Cost', w: 12 },
    ],
    mapDoc: (d) => ({
      date: d.date || '',
      machineName: d.machineName || '',
      kind: d.kind || 'breakdown',
      problem: d.problem || '',
      status: d.status || 'open',
      cost: d.cost ?? '',
    }),
  },
  {
    id: 'complaints',
    name: 'Customer Complaints & Claims',
    group: 'Commercial & Sales',
    icon: 'MessageSquareWarning',
    description: 'Stone quality feedback, damage reports, dimensions mismatch, resolution notes, and claim amounts.',
    importFormatNote: 'Matches Complaints Import format (Date, Customer, Problem, Status, Resolution)',
    model: Complaint,
    columns: [
      { key: 'date', label: 'Date', w: 12 },
      { key: 'customerName', label: 'Customer', w: 20 },
      { key: 'problem', label: 'Problem', w: 26 },
      { key: 'status', label: 'Status', w: 12 },
      { key: 'resolution', label: 'Resolution', w: 24 },
    ],
    mapDoc: (d) => ({
      date: d.date || '',
      customerName: d.customerName || '',
      problem: d.problem || '',
      status: d.status || 'open',
      resolution: d.resolution || '',
    }),
  },
  {
    id: 'documents',
    name: 'Important Papers & Vault',
    group: 'Financials & Accounts',
    icon: 'FileText',
    description: 'Mining leases, factory permits, pollution certificates, insurance, and company statutory documents.',
    importFormatNote: 'Matches Documents Import format (Name, Category, Reference No, Expiry Date, Notes)',
    model: PaperDoc,
    columns: [
      { key: 'name', label: 'Document Name', w: 24 },
      { key: 'category', label: 'Category', w: 16 },
      { key: 'refNo', label: 'Reference No', w: 16 },
      { key: 'expiryDate', label: 'Expiry Date', w: 14 },
      { key: 'notes', label: 'Notes', w: 24 },
    ],
    mapDoc: (d) => ({
      name: d.name || '',
      category: d.category || 'General',
      refNo: d.refNo || '',
      expiryDate: d.expiryDate || '',
      notes: d.notes || '',
    }),
  },
];

export const getSectionMeta = (id: string): SectionMeta | undefined =>
  BACKUP_SECTIONS.find((s) => s.id === id);

/**
 * Returns summary counts for all sections.
 */
export async function getBackupSectionsSummary(): Promise<{
  sections: Array<{
    id: string;
    name: string;
    group: string;
    icon: string;
    description: string;
    importFormatNote: string;
    count: number;
    columnsCount: number;
  }>;
  totalRecords: number;
  generatedAt: string;
}> {
  const summaries = await Promise.all(
    BACKUP_SECTIONS.map(async (sec) => {
      let count = 0;
      try {
        count = await sec.model.countDocuments({ isVoid: { $ne: true } });
      } catch {
        count = 0;
      }
      return {
        id: sec.id,
        name: sec.name,
        group: sec.group,
        icon: sec.icon,
        description: sec.description,
        importFormatNote: sec.importFormatNote,
        count,
        columnsCount: sec.columns.length,
      };
    })
  );

  const totalRecords = summaries.reduce((acc, s) => acc + s.count, 0);
  return {
    sections: summaries,
    totalRecords,
    generatedAt: todayIST(),
  };
}

/**
 * Queries section data from database, mapped to the exact import format.
 */
export async function getSectionData(section: SectionMeta, limit = 50000): Promise<{
  columns: SectionCol[];
  rows: Array<Record<string, any>>;
}> {
  const docs: any[] = await section.model
    .find({ isVoid: { $ne: true } })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  const mapped = docs.map((d) => section.mapDoc(d));
  return {
    columns: section.columns,
    rows: mapped,
  };
}

/**
 * Generate Excel workbook matching the import format.
 */
export async function generateSectionExcel(section: SectionMeta): Promise<Buffer> {
  const { columns, rows } = await getSectionData(section);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vipul Stone Suppliers ERP';
  wb.created = new Date();

  const sheetName = section.name.slice(0, 31).replace(/[\\/?*[\]:]/g, '_');
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Header row
  const headerLabels = columns.map((c) => c.label);
  const headRow = ws.addRow(headerLabels);
  headRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2A2421' }, // Premium Dark Charcoal
  };
  headRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headRow.height = 24;

  // Set column widths
  columns.forEach((col, idx) => {
    ws.getColumn(idx + 1).width = Math.max(col.w || 14, col.label.length + 3);
  });

  // Data rows
  rows.forEach((row) => {
    const values = columns.map((col) => {
      const v = row[col.key];
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') return Number.isFinite(v) ? v : '';
      return String(v);
    });
    const r = ws.addRow(values);
    r.height = 20;
    r.alignment = { vertical: 'middle' };
  });

  // Alternate row background for clean look
  for (let i = 2; i <= rows.length + 1; i++) {
    const row = ws.getRow(i);
    if (i % 2 === 0) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF9F6F0' }, // Sand whisper
      };
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Generate CSV matching the import format with UTF-8 BOM.
 */
export async function generateSectionCsv(section: SectionMeta): Promise<Buffer> {
  const { columns, rows } = await getSectionData(section);
  let csv = CSV_BOM;

  // Header
  csv += csvLine(columns.map((c) => c.label));

  // Rows
  for (const r of rows) {
    const cells = columns.map((c) => r[c.key]);
    csv += csvLine(cells);
  }

  return Buffer.from(csv, 'utf-8');
}

/**
 * Generate structured PDF report using PdfBuilder (Landscape).
 */
export async function generateSectionPdf(section: SectionMeta): Promise<Buffer> {
  const { columns, rows } = await getSectionData(section, 5000); // PDF budget limit
  const doc = await PdfBuilder.create(`Backup: ${section.name}`, { landscape: true });

  // Document Title Header
  doc.para('VIPUL STONE SUPPLIERS — BACKUP ARCHIVE', {
    bold: true,
    size: 14,
    color: 'ink',
    gap: 2,
  });

  doc.para(`${section.name} · Export Date: ${todayIST()} · Total Records: ${rows.length}`, {
    size: 9,
    color: 'grey',
    gap: 8,
  });

  doc.rule();
  doc.space(6);

  // Pick top 7-9 most important columns for PDF table width fit
  const displayCols = columns.length <= 8 ? columns : columns.slice(0, 8);
  const pdfCols = displayCols.map((c) => ({
    head: c.label,
    w: c.w || 14,
  }));

  const pdfRows = rows.map((r) =>
    displayCols.map((c) => {
      const v = r[c.key];
      return v === null || v === undefined ? '—' : String(v).slice(0, 45);
    })
  );

  doc.table(pdfCols, pdfRows, { size: 8 });

  return Buffer.from(await doc.bytes());
}

/**
 * Generate all sections bundled in a single ZIP file.
 * format: 'all' (Excel + CSV + PDF in folders) | 'xlsx' | 'csv' | 'pdf'
 */
export async function generateAllSectionsZip(format: 'all' | 'xlsx' | 'csv' | 'pdf' = 'xlsx'): Promise<Buffer> {
  const zip = new JSZip();
  const dateStr = todayIST();

  for (let idx = 0; idx < BACKUP_SECTIONS.length; idx++) {
    const section = BACKUP_SECTIONS[idx];
    const prefix = String(idx + 1).padStart(2, '0');
    const safeName = `${prefix}-${section.id}`;

    if (format === 'xlsx' || format === 'all') {
      const excelBuf = await generateSectionExcel(section);
      if (format === 'all') {
        zip.file(`excel/${safeName}.xlsx`, excelBuf);
      } else {
        zip.file(`${safeName}.xlsx`, excelBuf);
      }
    }

    if (format === 'csv' || format === 'all') {
      const csvBuf = await generateSectionCsv(section);
      if (format === 'all') {
        zip.file(`csv/${safeName}.csv`, csvBuf);
      } else {
        zip.file(`${safeName}.csv`, csvBuf);
      }
    }

    if (format === 'pdf' || format === 'all') {
      const pdfBuf = await generateSectionPdf(section);
      if (format === 'all') {
        zip.file(`pdf/${safeName}.pdf`, pdfBuf);
      } else {
        zip.file(`${safeName}.pdf`, pdfBuf);
      }
    }
  }

  // Add a README metadata file inside the zip explaining the backup contents
  const readme = `================================================================================
STONE ERP — COMPLETE DATA BACKUP ARCHIVE
Generated: ${dateStr}
Organization: Vipul Stone Suppliers
Format: Import-Compatible (Re-import directly into StoneERP)
================================================================================

Sections Included (${BACKUP_SECTIONS.length} total):
${BACKUP_SECTIONS.map((s, i) => `${String(i + 1).padStart(2, '0')}. ${s.name} (${s.id}) - ${s.importFormatNote}`).join('\n')}

Note:
All Excel and CSV files use the exact column headers and structure expected by
StoneERP Data Import. You can upload any exported file directly via "Import from Excel".
`;

  zip.file('README.txt', readme);

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
