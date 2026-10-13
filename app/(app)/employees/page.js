'use client';
import ImportEmployees from '@/components/ImportEmployees';
import { loginFields, toLogin } from '@/components/loginFields';
import { AlertTriangle } from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Badge } from '@/components/ui';
import { EMPLOYEE_FIELDS, missingDocs } from '@/components/fields';
import { useApp } from '@/components/Providers';
import { JOBS } from '@/lib/config';
import { inr, fmtDate } from '@/lib/format';

export default function EmployeesPage() {
  const { t, can, perm } = useApp();
  const showPay = ['read', 'write'].includes(perm?.fields?.money);
  const mayLogin = can('users', 'create') || can('users', 'edit'); // managing sign-ins is part of the profile now
  const fields = [...EMPLOYEE_FIELDS, ...(mayLogin ? loginFields() : [])];
  const columns = [
    { key: 'name', label: 'Name', primary: true, render: (r) => <span>{r.name} <span className="text-char-500 font-normal text-xs">{r.empCode}</span></span> },
    { key: 'job', label: 'Job' },
    { key: 'site', label: 'Site' },
    { key: 'mobile', label: 'Mobile' },
    ...(showPay ? [{ key: 'payType', label: 'Pay', render: (r) => r.payType ? `${inr(r.rate)} ${r.payType === 'monthly' ? '/ month' : r.payType === 'daily' ? '/ day' : r.pieceUnit === 'piece' ? '/ piece' : '/ sq ft'}` : '—' }] : []),
    { key: 'joiningDate', label: 'Joined', render: (r) => fmtDate(r.joiningDate) },
    { label: 'Documents', wide: true, render: (r) => {
      const m = missingDocs(r);
      return m.length ? <Badge tone="red"><AlertTriangle size={11} /> Missing: {m.join(', ')}</Badge> : <Badge tone="green">Complete</Badge>;
    } },
    ...(mayLogin ? [{ key: 'hasLogin', label: 'Sign-in', render: (r) => (r.hasLogin ? <Badge tone="green">{r.loginRole || 'yes'}</Badge> : <span className="text-char-300">—</span>) }] : []),
    { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.isVoid ? 'void' : r.status === 'left' ? 'void' : 'active'} /> },
  ];
  return (
    <RoleGuard perm="employees">
      <CrudPage
        model="employees" title={t('employees')} subtitle="One profile per person, with documents" label="Employee"
        fields={fields} columns={columns}
        loadExtra={async (full) => ({ _job0: full.job, loginPassword: '' })}
        mapBody={(body, mode, form) => {
          const { loginPassword, ...rest } = body;
          if (!mayLogin) return rest;
          const login = toLogin({ loginPassword, job: rest.job ?? form.job }, { hasLogin: form.hasLogin, originalJob: form._job0 });
          return login ? { ...rest, login } : rest;
        }}
        exportName="employees"
        exportColumns={[{ key: 'empCode', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'job', label: 'Job' }, { key: 'site', label: 'Site' }, { key: 'mobile', label: 'Mobile' }, { key: 'payType', label: 'Pay type' }, { key: 'rate', label: 'Rate' }, { key: 'joiningDate', label: 'Joining date' }]}
      />
    </RoleGuard>
  );
}
