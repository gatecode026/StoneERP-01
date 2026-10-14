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
  { name: 'name', label: 'Name', required: true, section: 'Personal Details' },
  { name: 'mobile', label: 'Mobile number', type: 'tel', required: true, section: 'Personal Details' },
  { name: 'photo', label: 'Photo', type: 'photo', buttonLabel: 'Add photo', section: 'Personal Details', half: true },
  { name: 'empCode', label: 'Employee code', readOnlyOnEdit: true, placeholder: 'Auto', hint: 'Leave empty to auto-generate', section: 'Personal Details' },
  { name: 'fatherName', label: "Father's name", group: 'pii', section: 'Personal Details' },
  { name: 'address', label: 'Address', group: 'pii', wide: true, section: 'Personal Details' },

  { name: 'job', label: 'Job', type: 'select', options: JOBS, required: true, section: 'Job & Workplace' },
  { name: 'site', label: 'Where they work', type: 'select', options: ['Factory', 'Yard', 'Quarry', 'Office', 'Gate'], default: 'Factory', section: 'Job & Workplace' },
  { name: 'supervisorCode', label: 'Supervisor (team)', type: 'ref', ref: { model: 'employees', valueKey: 'empCode', label: (e) => `${e.name} (${e.job})`, query: { status: 'active', job: 'Supervisor' } }, hint: 'Decides whose team this person is in', section: 'Job & Workplace' },
  { name: 'joiningDate', label: 'Joining date', type: 'date', section: 'Job & Workplace' },
  { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Working' }, { value: 'left', label: 'Left' }], default: 'active', section: 'Job & Workplace' },
  { name: 'leavingDate', label: 'Leaving date', type: 'date', show: (f) => f.status === 'left', section: 'Job & Workplace' },

  { name: 'payType', label: 'Pay type', type: 'select', required: true, group: 'money', options: [{ value: 'monthly', label: 'Monthly' }, { value: 'daily', label: 'Daily' }, { value: 'piece', label: 'Per sq ft / piece' }], default: 'monthly', section: 'Salary & Banking' },
  { name: 'rate', label: 'Pay rate (₹)', type: 'number', required: true, group: 'money', hint: 'Monthly salary, daily wage, or rate per sq ft / piece', section: 'Salary & Banking' },
  { name: 'pieceUnit', label: 'Piece-rate unit', type: 'select', group: 'money', options: [{ value: 'sqft', label: 'per sq ft' }, { value: 'piece', label: 'per piece' }], show: (f) => f.payType === 'piece', section: 'Salary & Banking' },
  { name: 'bankAccount', label: 'Bank account', group: 'pii', section: 'Salary & Banking' },
  { name: 'upi', label: 'UPI id', group: 'pii', section: 'Salary & Banking' },
  { name: 'pfApplicable', label: 'PF', type: 'checkbox', checkLabel: 'PF applicable', group: 'money', section: 'Salary & Banking' },
  { name: 'pfNo', label: 'PF number', group: 'money', show: (f) => f.pfApplicable, section: 'Salary & Banking' },
  { name: 'esiApplicable', label: 'ESI', type: 'checkbox', checkLabel: 'ESI applicable', group: 'money', section: 'Salary & Banking' },
  { name: 'esiNo', label: 'ESI number', group: 'money', show: (f) => f.esiApplicable, section: 'Salary & Banking' },

  { name: 'aadhaarNo', label: 'Aadhaar number (12 digits)', group: 'pii', hint: 'Stored encrypted; only the last 4 digits are shown', section: 'Documents & Verification' },
  { name: 'panNo', label: 'PAN', group: 'pii', section: 'Documents & Verification' },
  { name: 'docAadhaar', label: 'Aadhaar (masked) photo', type: 'photo', buttonLabel: 'Upload Aadhaar', group: 'pii', half: true, section: 'Documents & Verification' },
  { name: 'docPan', label: 'PAN photo', type: 'photo', buttonLabel: 'Upload PAN', group: 'pii', half: true, section: 'Documents & Verification' },
  { name: 'docPassbook', label: 'Bank passbook photo', type: 'photo', buttonLabel: 'Upload passbook', group: 'pii', half: true, section: 'Documents & Verification' },
  { name: 'docLicense', label: 'Driving licence photo', type: 'photo', buttonLabel: 'Upload licence', group: 'pii', half: true, section: 'Documents & Verification' },

  { name: 'emergencyName', label: 'Emergency contact name', group: 'pii', section: 'Emergency Contact' },
  { name: 'emergencyMobile', label: 'Emergency contact number', type: 'tel', group: 'pii', section: 'Emergency Contact' },
];

// lists never carry the document images, only presence flags (docFlags) — so supervisors see "present / missing" and nothing more
export const REQUIRED_DOCS = [['aadhaar', 'Aadhaar'], ['passbook', 'Passbook']];
export const missingDocs = (e) => REQUIRED_DOCS.filter(([k]) => !e.docFlags?.[k]).map(([, n]) => n);
