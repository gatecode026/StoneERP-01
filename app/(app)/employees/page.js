'use client';
import { AlertTriangle } from 'lucide-react';
import CrudPage, { StatusBadge } from '@/components/CrudPage';
import { RoleGuard, Badge } from '@/components/ui';
import { EMPLOYEE_FIELDS, missingDocs } from '@/components/fields';
import { useApp } from '@/components/Providers';
import { JOBS } from '@/lib/config';
import { inr, fmtDate } from '@/lib/format';

export default function EmployeesPage() {
  const { t, role } = useApp();
  const showPay = role !== 'supervisor';
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
    { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status === 'left' ? 'void' : 'active'} /> },
  ];
  return (
    <RoleGuard perm="employees">
      <CrudPage
        model="employees" title={t('employees')} subtitle="One profile per person, with documents" label="Employee"
        fields={EMPLOYEE_FIELDS} columns={columns} searchKeys={['name', 'job', 'site', 'empCode', 'mobile']} sort="empCode"
        canAdd={['owner', 'manager', 'accountant'].includes(role)} canEdit={() => ['owner', 'manager', 'accountant'].includes(role)}
        filters={[
          { key: 'job', label: 'All jobs', options: JOBS },
          { key: 'site', label: 'All sites', options: ['Factory', 'Yard', 'Quarry', 'Office', 'Gate'] },
          { key: 'docs', label: 'Documents', options: [{ value: 'missing', label: 'Missing documents' }], test: (r, v) => v === 'missing' && missingDocs(r).length > 0 },
          { key: 'status', label: 'Working + left', options: [{ value: 'active', label: 'Working' }, { value: 'left', label: 'Left' }] },
        ]}
        summary={(rows, all) => {
          const miss = all.filter((e) => missingDocs(e).length).length;
          return miss ? <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 flex items-center gap-2"><AlertTriangle size={16} /> {miss} employees have a missing document</div> : null;
        }}
        exportName="employees"
        exportColumns={[{ key: 'empCode', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'job', label: 'Job' }, { key: 'site', label: 'Site' }, { key: 'mobile', label: 'Mobile' }, { key: 'payType', label: 'Pay type' }, { key: 'rate', label: 'Rate' }, { key: 'joiningDate', label: 'Joining date' }]}
      />
    </RoleGuard>
  );
}
