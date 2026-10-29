'use client';
import ImportEmployees from '@/components/ImportEmployees';
import { loginFields, toLogin } from '@/components/loginFields';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Badge } from '@/components/ui';
import { EMPLOYEE_FIELDS, missingDocs } from '@/components/fields';
import { useApp } from '@/components/Providers';
import { JOBS } from '@/lib/config';
import { inr, fmtDate } from '@/lib/format';
import { api } from '@/lib/client';
import toast from '@/lib/toast';
import T from '@/components/T';

export default function EmployeesPage() {
  const { t, can, perm, session } = useApp();
  const showPay = ['read', 'write'].includes(perm?.fields?.money);
  const mayLogin = can('users', 'create') || can('users', 'edit'); // managing sign-ins is part of the profile now
  // the password sits right below the mobile number: mobile = sign-in ID, password = how they sign in
  const at = EMPLOYEE_FIELDS.findIndex((f) => f.name === 'mobile') + 1;
  // the shift list comes from Settings (Working hours)
  const shiftOptions = (session?.shifts || []).map((x) => ({ value: x.id, label: `${x.name} (${x.start}–${x.end})` }));
  const base = EMPLOYEE_FIELDS.map((f) => (f.name === 'shiftId' ? { ...f, options: shiftOptions } : f));
  const fields = mayLogin ? [...base.slice(0, at), ...loginFields(), ...base.slice(at)] : base;
  const columns = [
    { key: 'name', label: 'Name', primary: true, render: (r) => <span>{r.name} <span className="text-char-500 font-normal text-xs">{r.empCode}</span></span> },
    { key: 'job', label: 'Job' },
    { key: 'site', label: 'Site' },
    { key: 'mobile', label: 'Mobile' },
    ...(mayLogin ? [{
      key: 'plainPassword',
      label: 'Password',
      render: (r) => (
        <span className="font-mono bg-sand-50 px-2 py-0.5 border border-sand-200 text-xs font-bold text-char-800">
          {r.plainPassword || '123456'}
        </span>
      ),
    }] : []),
    ...(showPay ? [{ key: 'payType', label: 'Pay', render: (r) => r.payType ? `${inr(r.rate)} ${r.payType === 'monthly' ? '/ month' : r.payType === 'daily' ? '/ day' : r.pieceUnit === 'piece' ? '/ piece' : '/ sq ft'}` : '—' }] : []),
    { key: 'joiningDate', label: 'Joined', render: (r) => fmtDate(r.joiningDate) },
    { label: 'Documents', wide: true, render: (r) => {
      const m = missingDocs(r);
      return m.length ? <Badge tone="red"><AlertTriangle size={11} /> <T>Missing:</T> {m.join(', ')}</Badge> : <Badge tone="green"><T>Complete</T></Badge>;
    } },
    ...(mayLogin ? [{ key: 'hasLogin', label: 'Sign-in', render: (r) => (r.hasLogin ? <Badge tone="green">{r.loginRole || 'yes'}</Badge> : <span className="text-char-300">—</span>) }] : []),
    { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.isVoid ? 'deactivated' : r.status === 'left' ? 'left' : 'active'} /> },
  ];
  return (
    <RoleGuard perm="employees">
      <CrudPage
        model="employees" title={t('employees')} subtitle="One profile per person, with documents" label="Employee"
        fields={fields} columns={columns} sort="empCode" pagination={25} wide headerExtra={<ImportEmployees />}
        voidLabel="Deactivate"
        voidTitle="Deactivate Employee"
        voidPrompt="Nothing is deleted — the profile will be deactivated, sign-in access disabled, and moved to the deactivated list."
        voidSuccessMsg="Employee deactivated"
        rowActions={(row, { reload }) => (
          row.isVoid && can('employees', 'edit') ? [{
            label: 'Reactivate',
            tone: 'green',
            icon: <RotateCcw size={14} className="shrink-0 text-emerald-600" />,
            onClick: async () => {
              try {
                await api(`/api/employees/${row._id}/reactivate`, { method: 'POST' });
                toast.success('Employee reactivated');
                reload();
              } catch (e) {
                toast.error(e.message);
              }
            },
          }] : []
        )}
        loadExtra={async (full) => ({ _job0: full.job, loginPassword: full.plainPassword || '123456' })}
        mapBody={(body, mode, form) => {
          const { loginPassword, ...rest } = body;
          if (!mayLogin) return rest;
          const login = toLogin({ loginPassword, job: rest.job ?? form.job }, { hasLogin: form.hasLogin, originalJob: form._job0 });
          return login ? { ...rest, login } : rest;
        }}
        
        filters={[
          { key: 'job', label: 'All jobs', options: JOBS },
          { key: 'site', label: 'All sites', options: ['Factory', 'Yard', 'Quarry', 'Office', 'Gate'] },
          { key: 'docs', label: 'Documents', options: [{ value: 'missing', label: 'Missing documents' }] },
          {
            key: 'status',
            label: 'All status',
            options: [
              { value: 'active', label: 'Working' },
              { value: 'left', label: 'Left' },
              { value: 'deactivated', label: 'Deactivated' },
            ],
            toQuery: (val) => (val === 'deactivated' ? { includeVoid: '1', deactivated: '1' } : { status: val }),
          },
        ]}
        facets={{ by: 'status', query: { docs: 'missing', status: 'active' } }}
        summary={(rows, { facets: f }) => {
          const miss = f?.total || 0; // active employees without Aadhaar or passbook on file, counted by the server
          return miss ? <div className="rounded-none bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 flex items-center gap-2"><AlertTriangle size={16} /> <T vars={{ n: miss }}>{'{n} working employees have a missing document'}</T></div> : null;
        }}
        exportName="employees"
        exportColumns={[{ key: 'empCode', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'job', label: 'Job' }, { key: 'site', label: 'Site' }, { key: 'mobile', label: 'Mobile' }, { key: 'payType', label: 'Pay type' }, { key: 'rate', label: 'Rate' }, { key: 'joiningDate', label: 'Joining date' }]}
      />
    </RoleGuard>
  );
}
