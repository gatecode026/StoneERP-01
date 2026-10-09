// Shared field configs for CrudPage forms
import { JOBS } from '@/lib/config';

export const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];

export const CUSTOMER_FIELDS = [
  { name: 'name', label: 'Customer name', required: true, wide: true },
  { name: 'mobile', label: 'Mobile / WhatsApp', type: 'tel', required: true },
  { name: 'gstin', label: 'GST number' },
  { name: 'address', label: 'Address', wide: true },
  { name: 'city', label: 'City' },
  { name: 'state', label: 'State', default: 'Rajasthan' },
  { name: 'country', label: 'Country', default: 'India', hint: 'Anything other than India = export (no GST, LUT)' },
  { name: 'type', label: 'Type', type: 'select', options: ['Domestic', 'Export'], default: 'Domestic' },
];

export const EMPLOYEE_FIELDS = [
  { name: 'name', label: 'Name', required: true },
  { name: 'mobile', label: 'Mobile number', type: 'tel', required: true },
  { name: 'photo', label: 'Photo', type: 'photo', buttonLabel: 'Add photo' },
  { name: 'empCode', label: 'Employee code', readOnlyOnEdit: true, placeholder: 'Auto', hint: 'Leave empty to auto-generate' },
  { name: 'fatherName', label: "Father's name" },
  { name: 'address', label: 'Address' },
  { name: 'job', label: 'Job', type: 'select', options: JOBS, required: true },
  { name: 'site', label: 'Where they work', type: 'select', options: ['Factory', 'Yard', 'Quarry', 'Office', 'Gate'], default: 'Factory' },
  { name: 'joiningDate', label: 'Joining date', type: 'date' },
  { name: 'payType', label: 'Pay type', type: 'select', required: true, options: [{ value: 'monthly', label: 'Monthly' }, { value: 'daily', label: 'Daily' }, { value: 'piece', label: 'Per sq ft / piece' }], default: 'monthly' },
  { name: 'rate', label: 'Pay rate (₹)', type: 'number', required: true, hint: 'Monthly salary, daily wage, or rate per sq ft / piece' },
  { name: 'pieceUnit', label: 'Piece-rate unit', type: 'select', options: [{ value: 'sqft', label: 'per sq ft' }, { value: 'piece', label: 'per piece' }], show: (f) => f.payType === 'piece' },
  { name: 'bankAccount', label: 'Bank account' },
  { name: 'upi', label: 'UPI id' },
  { name: 'pfApplicable', label: 'PF', type: 'checkbox', checkLabel: 'PF applicable' },
  { name: 'pfNo', label: 'PF number', show: (f) => f.pfApplicable },
  { name: 'esiApplicable', label: 'ESI', type: 'checkbox', checkLabel: 'ESI applicable' },
  { name: 'doc_aadhaar', label: 'Aadhaar (masked) photo', type: 'photo', buttonLabel: 'Upload Aadhaar' },
  { name: 'doc_pan', label: 'PAN photo', type: 'photo', buttonLabel: 'Upload PAN' },
  { name: 'doc_passbook', label: 'Bank passbook photo', type: 'photo', buttonLabel: 'Upload passbook' },
  { name: 'doc_license', label: 'Driving licence photo', type: 'photo', buttonLabel: 'Upload licence' },
  { name: 'emergencyName', label: 'Emergency contact name' },
  { name: 'emergencyMobile', label: 'Emergency contact number', type: 'tel' },
  { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Working' }, { value: 'left', label: 'Left' }], default: 'active' },
  { name: 'leavingDate', label: 'Leaving date', type: 'date', show: (f) => f.status === 'left' },
];

export const REQUIRED_DOCS = [['doc_aadhaar', 'Aadhaar'], ['doc_passbook', 'Passbook']];
export const missingDocs = (e) => REQUIRED_DOCS.filter(([k]) => !e[k]).map(([, n]) => n);
