// Shared field configs for CrudPage forms
import { JOBS, DESIGNATIONS } from '@/lib/config';
import { joiningDateProblem } from '@/lib/validators';
import { STATE_NAMES, canonicalState, stateOfGstin } from '@/lib/gst';

export const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];

export const CUSTOMER_FIELDS = [
  { name: 'name', label: 'Customer name', required: true, wide: true, rule: 'partyName' },
  { name: 'mobile', label: 'Mobile / WhatsApp', type: 'tel', required: true, rule: 'mobile', hint: '10 digits, starting with 6, 7, 8 or 9' },
  { name: 'type', label: 'Type', type: 'select', options: ['Domestic', 'Export'], default: 'Domestic', required: true, hint: 'Export = a customer outside India (no GST, LUT)',
    onChange: (v) => ({ country: v === 'Domestic' ? 'India' : '' }) },
  { name: 'gstin', label: 'GST number', rule: 'gstin', show: (f) => f.type !== 'Export', hint: 'Leave empty if the customer has none. 15 characters, like 08AAAAA0000A1Z5',
    validate: (f) => { const st = stateOfGstin(f.gstin); const named = canonicalState(f.state); return st && named && st !== named ? `This GST number is for ${st}, but the state chosen is ${named}` : ''; } },
  { name: 'address', label: 'Address', wide: true },
  { name: 'city', label: 'City', rule: 'place' },
  { name: 'state', label: 'State', type: 'select', options: STATE_NAMES, default: 'Rajasthan', required: true, show: (f) => f.type !== 'Export', hint: 'Decides CGST + SGST or IGST on the bill' },
  { name: 'country', label: 'Country', required: true, show: (f) => f.type === 'Export', validate: (f) => (f.type === 'Export' && String(f.country || '').toLowerCase().replace(/[^a-z]/g, '') === 'india' ? 'An export customer is outside India' : '') },
];

export const EMPLOYEE_FIELDS = [
  { name: 'name', label: 'Name', required: true, rule: 'name', section: 'Personal Details' },
  { name: 'mobile', label: 'Mobile number', type: 'tel', required: true, rule: 'mobile', hint: '10 digits, starting with 6, 7, 8 or 9. This is also their sign-in ID', section: 'Personal Details' },
  { name: 'photo', label: 'Photo', type: 'photo', buttonLabel: 'Add photo', section: 'Personal Details', half: true },
  { name: 'fatherName', label: "Father's name", group: 'pii', rule: 'fatherName', section: 'Personal Details' },
  { name: 'address', label: 'Address', group: 'pii', wide: true, section: 'Personal Details' },

  { name: 'job', label: 'Job', type: 'select', options: JOBS, required: true, section: 'Job & Workplace' },
  { name: 'designation', label: 'Designation', type: 'select', options: DESIGNATIONS, hint: 'Optional. What they actually do, e.g. Driver. Trips offer only Drivers', section: 'Job & Workplace' },
  { name: 'site', label: 'Where they work', type: 'select', options: ['Factory', 'Yard', 'Quarry', 'Office', 'Gate'], default: 'Factory', section: 'Job & Workplace' },
  { name: 'supervisorCode', label: 'Supervisor (team)', type: 'ref', ref: { model: 'employees', valueKey: 'empCode', label: (e) => `${e.name} (${e.job})`, query: { status: 'active', job: 'Supervisor' } }, hint: 'Pick a supervisor to assign this employee to their team. Supervisors: Pintu Ji Purohit, Kalu Ji Meena, Shiv Ji Mali, Jagdhi Ji Dhakar, Ashish Ji Parashar, Naresh Ji Meena, Dilkhush Ji Dhakar, Harish Vijay, Mukesh Ji Jain, Mukesh Ji Regar, Piyush Parashar, Dharmraj Banjara, Deepak Sen, Kamlesh Ji Meena', section: 'Job & Workplace' },
  { name: 'shiftId', label: 'Shift', type: 'select', options: [], hint: 'Leave empty for the default shift (Settings → Working hours)', section: 'Job & Workplace' },
  { name: 'biometricId', label: 'Biometric ID', hint: 'The number the biometric machine knows this person by', section: 'Job & Workplace' },
  { name: 'joiningDate', label: 'Joining date', type: 'date', validate: (f) => (f.joiningDate ? joiningDateProblem(f.joiningDate, f.status === 'left' ? f.leavingDate : '') : ''), section: 'Job & Workplace' },
  { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Working' }, { value: 'left', label: 'Left' }], default: 'active', section: 'Job & Workplace' },
  { name: 'leavingDate', label: 'Leaving date', type: 'date', show: (f) => f.status === 'left', validate: (f) => (f.leavingDate && f.joiningDate && f.leavingDate < f.joiningDate ? 'Leaving date is before the joining date' : ''), section: 'Job & Workplace' },

  { name: 'payType', label: 'Pay type', type: 'select', required: true, group: 'money', options: [{ value: 'monthly', label: 'Monthly' }, { value: 'daily', label: 'Daily' }, { value: 'piece', label: 'Per sq ft / piece' }], default: 'monthly', section: 'Salary & Banking' },
  { name: 'rate', label: 'Pay rate (₹)', type: 'number', required: true, group: 'money', validate: (f) => (f.rate === '' || f.rate == null ? '' : !(Number(f.rate) > 0) ? 'Pay rate must be more than 0' : Number(f.rate) > 1e7 ? 'Pay rate is too large' : ''), hint: 'Monthly salary, daily wage, or rate per sq ft / piece', section: 'Salary & Banking' },
  { name: 'pieceUnit', label: 'Piece-rate unit', type: 'select', group: 'money', options: [{ value: 'sqft', label: 'per sq ft' }, { value: 'piece', label: 'per piece' }], show: (f) => f.payType === 'piece', section: 'Salary & Banking' },
  { name: 'bankAccount', label: 'Bank account number', group: 'pii', rule: 'bankAccount', hint: '9 to 18 digits. Stored encrypted', section: 'Salary & Banking' },
  { name: 'ifsc', label: 'IFSC code', group: 'pii', rule: 'ifsc', hint: 'Bank branch code, e.g. SBIN0001234', section: 'Salary & Banking' },
  { name: 'upi', label: 'UPI id', group: 'pii', rule: 'upi', hint: 'For example 9829012345@ybl', section: 'Salary & Banking' },
  { name: 'pfApplicable', label: 'PF', type: 'checkbox', checkLabel: 'PF applicable', group: 'money', section: 'Salary & Banking' },
  { name: 'pfNo', label: 'PF number', group: 'money', rule: 'pfNo', hint: '12-digit UAN or PF account number', show: (f) => f.pfApplicable, section: 'Salary & Banking' },
  { name: 'esiApplicable', label: 'ESI', type: 'checkbox', checkLabel: 'ESI applicable', group: 'money', section: 'Salary & Banking' },
  { name: 'esiNo', label: 'ESI number', group: 'money', rule: 'esiNo', hint: '10 digits', show: (f) => f.esiApplicable, section: 'Salary & Banking' },

  { name: 'aadhaarNo', label: 'Aadhaar number (12 digits)', group: 'pii', rule: 'aadhaarNo', hint: 'Checked for a valid number. Stored encrypted; only the last 4 digits are shown', section: 'Documents & Verification' },
  { name: 'panNo', label: 'PAN', group: 'pii', rule: 'panNo', hint: 'Like ABCDE1234F', section: 'Documents & Verification' },
  { name: 'docAadhaar', label: 'Aadhaar (masked) photo', type: 'photo', buttonLabel: 'Upload Aadhaar', group: 'pii', half: true, section: 'Documents & Verification' },
  { name: 'docPan', label: 'PAN photo', type: 'photo', buttonLabel: 'Upload PAN', group: 'pii', half: true, section: 'Documents & Verification' },
  { name: 'docPassbook', label: 'Bank passbook photo', type: 'photo', buttonLabel: 'Upload passbook', group: 'pii', half: true, section: 'Documents & Verification' },
  { name: 'docLicense', label: 'Driving licence photo', type: 'photo', buttonLabel: 'Upload licence', group: 'pii', half: true, section: 'Documents & Verification' },

  { name: 'emergencyName', label: 'Emergency contact name', group: 'pii', rule: 'emergencyName', section: 'Emergency Contact' },
  { name: 'emergencyMobile', label: 'Emergency contact number', type: 'tel', group: 'pii', rule: 'emergencyMobile', validate: (f) => (f.emergencyMobile && f.mobile && f.emergencyMobile === f.mobile ? 'Use a different number from the employee’s own mobile' : ''), section: 'Emergency Contact' },
];

// lists never carry the document images, only presence flags (docFlags) — so supervisors see "present / missing" and nothing more
export const REQUIRED_DOCS = [['aadhaar', 'Aadhaar'], ['passbook', 'Passbook']];
export const missingDocs = (e) => REQUIRED_DOCS.filter(([k]) => !e.docFlags?.[k]).map(([, n]) => n);
