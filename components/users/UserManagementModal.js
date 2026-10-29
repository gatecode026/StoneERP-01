'use client';
import { useState, useMemo, useEffect } from 'react';
import { Sheet, SearchBox, Badge } from '@/components/ui';
import { useFetch } from '@/components/Providers';
import toast from '@/lib/toast';
import { Users, Copy, Check, KeyRound, Eye, EyeOff } from 'lucide-react';
import T from '@/components/T';

export default function UserManagementModal({ open, onClose }) {
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [showPasswords, setShowPasswords] = useState(true);

  const { data, loading, reload } = useFetch(
    open ? `/api/admin/users?q=${encodeURIComponent(q)}&role=${encodeURIComponent(roleFilter)}` : null,
    [open, q, roleFilter]
  );

  useEffect(() => {
    if (open) {
      reload();
    }
  }, [open]);

  const users = data?.data || [];

  async function handleCopy(text, id) {
    if (!text || text === '—') return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="User Management"
      className="md:!max-w-4xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-xs text-char-500 font-medium">
            <T vars={{ n: users.length }}>{'{n} users found'}</T>
          </div>
          <button
            type="button"
            className="btn-outline !text-xs !py-1.5 !px-4"
            onClick={onClose}
          >
            <T>Close</T>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Info header alert */}
        <div className="p-3 bg-amber-50/70 border border-amber-200 text-amber-900 rounded-none text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-amber-700 shrink-0" />
            <span>
              <T>Default password for all employee logins is set to</T>{' '}
              <strong className="font-mono bg-white px-1.5 py-0.5 border border-amber-300">123456</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowPasswords((v) => !v)}
            className="text-xs font-semibold text-amber-800 hover:text-amber-950 flex items-center gap-1 cursor-pointer bg-white px-2 py-1 border border-amber-200"
          >
            {showPasswords ? <EyeOff size={13} /> : <Eye size={13} />}
            {showPasswords ? <T>Hide Passwords</T> : <T>Show Passwords</T>}
          </button>
        </div>

        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Search name or phone…"
            className="flex-1 min-w-[200px]"
          />
          <select
            className="input !w-auto min-w-[150px] bg-white cursor-pointer font-medium text-xs text-char-800"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
          >
            <option value=""><T>All roles</T></option>
            <option value="supervisor"><T>Supervisor</T></option>
            <option value="operator"><T>Operator</T></option>
            <option value="worker"><T>Worker / Labour</T></option>
            <option value="manager"><T>Manager</T></option>
            <option value="accountant"><T>Accountant</T></option>
            <option value="salesperson"><T>Salesperson</T></option>
          </select>
          {(q || roleFilter) && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                setRoleFilter('');
              }}
              className="btn-ghost !text-xs !py-1.5 !px-2.5 border border-sand-300 text-char-600"
            >
              <T>Clear</T>
            </button>
          )}
        </div>

        {/* Table containing strictly Name, Phone Number, Password */}
        <div className="border border-sand-200 overflow-x-auto bg-white max-h-[60vh] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-sand-50/80 sticky top-0 z-10 border-b border-sand-200">
              <tr>
                <th className="py-2.5 px-3 font-semibold text-char-700">
                  <T>Name</T>
                </th>
                <th className="py-2.5 px-3 font-semibold text-char-700">
                  <T>Phone Number</T>
                </th>
                <th className="py-2.5 px-3 font-semibold text-char-700">
                  <T>Password</T>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-char-400">
                    <T>Loading users…</T>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-char-400">
                    <T>No people found</T>
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-sand-50/50 transition-colors">
                    {/* Name */}
                    <td className="py-2.5 px-3">
                      <span className="font-semibold text-char-900 block">{u.name}</span>
                    </td>

                    {/* Phone Number */}
                    <td className="py-2.5 px-3 font-mono">
                      {u.phone && u.phone !== '—' ? (
                        <div className="inline-flex items-center gap-1.5">
                          <span>{u.phone}</span>
                          <button
                            type="button"
                            onClick={() => handleCopy(u.phone, `phone-${u.id}`)}
                            className="text-char-400 hover:text-char-700 p-0.5 rounded cursor-pointer"
                            title="Copy phone"
                          >
                            {copiedId === `phone-${u.id}` ? (
                              <Check size={13} className="text-emerald-600" />
                            ) : (
                              <Copy size={13} />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-char-300">—</span>
                      )}
                    </td>

                    {/* Password */}
                    <td className="py-2.5 px-3 font-mono">
                      <div className="inline-flex items-center gap-1.5 bg-sand-50 px-2 py-0.5 border border-sand-200">
                        <span className="font-bold text-char-800 tracking-wider">
                          {showPasswords ? u.password : '••••••'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(u.password, `pw-${u.id}`)}
                          className="text-char-400 hover:text-char-700 p-0.5 rounded cursor-pointer"
                          title="Copy password"
                        >
                          {copiedId === `pw-${u.id}` ? (
                            <Check size={13} className="text-emerald-600" />
                          ) : (
                            <Copy size={13} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Sheet>
  );
}
