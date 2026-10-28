'use client';
import { useState } from 'react';
import { Sheet, Field } from '@/components/ui';
import MultiLookupSelect from '@/components/MultiLookupSelect';
import { api } from '@/lib/client';
import toast from '@/lib/toast';
import { todayISO } from '@/lib/format';
import { useApp } from '@/components/Providers';
import { ListChecks, Calendar, CheckSquare } from 'lucide-react';
import T from '@/components/T';

export default function DailyTaskModal({ open, onClose, onDone, defaultDate }) {
  const { session, role } = useApp();
  const isSupervisor = role === 'supervisor' || session?.role === 'supervisor' || session?.preset === 'supervisor';
  const supervisorEmpCode = session?.empCode;

  const [dueDate, setDueDate] = useState(defaultDate || todayISO());
  const [title, setTitle] = useState('');
  const [selectedCodes, setSelectedCodes] = useState([]);
  const [selectedNames, setSelectedNames] = useState('');
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setDueDate(defaultDate || todayISO());
    setTitle('');
    setSelectedCodes([]);
    setSelectedNames('');
  }

  function handleClose() {
    resetForm();
    onClose?.();
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      toast.error('Task is required');
      return;
    }
    if (!selectedCodes.length) {
      toast.error('Please select at least one assignee');
      return;
    }

    setBusy(true);
    try {
      await api('/api/tasks', {
        method: 'POST',
        body: {
          title: cleanTitle,
          assignedCode: selectedCodes.join(','),
          dueDate: dueDate || todayISO(),
          priority: 'Normal',
        },
      });
      toast.success('Task assigned successfully ✔');
      handleClose();
      onDone?.();
    } catch (err) {
      toast.error(err.message || 'Failed to assign task');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title="Assign Daily Task"
      className="md:!max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            className="btn-outline !text-xs !py-1.5 !px-3"
            onClick={handleClose}
            disabled={busy}
          >
            <T>Cancel</T>
          </button>
          <button
            type="button"
            className="btn-primary !text-xs !py-1.5 !px-4 flex items-center gap-1.5 font-bold shadow-xs"
            onClick={handleSubmit}
            disabled={busy}
          >
            <ListChecks size={15} />
            {busy ? <T>Assigning…</T> : <T>Assign Task</T>}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Date */}
        <Field label="Date" required>
          <input
            type="date"
            className="input text-xs"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
          />
        </Field>

        {/* Task description */}
        <Field label="Task" required hint="Write what needs to be done today">
          <textarea
            className="input !text-sm leading-relaxed"
            rows={3}
            placeholder="e.g. Cut 20 slabs of Kandla Grey, check Wireshow blade, inspect raw blocks…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
        </Field>

        {/* Assign To (Supervisor / Operator) with Checkboxes */}
        <div className="pb-2">
          <label className="label">
            <T>Assign to (Supervisor / Operator)</T> *
          </label>
          <MultiLookupSelect
            kind="employees"
            by="empCode"
            query={
              isSupervisor && supervisorEmpCode
                ? { status: 'active', supervisorCode: supervisorEmpCode }
                : { status: 'active', job: 'Supervisor,Worker / operator,Operator,Worker,Helper' }
            }
            value={selectedCodes}
            valueLabel={selectedNames}
            placeholder="Select supervisors or operators…"
            emptyText="No supervisors or operators found"
            onChange={(selected) => {
              setSelectedCodes(selected.map((s) => s.id));
              setSelectedNames(selected.map((s) => s.label).join(', '));
            }}
          />
          <p className="text-[11px] text-char-500 mt-1.5">
            <T>Select one or more supervisors or operators for this task</T>
          </p>
        </div>
      </form>
    </Sheet>
  );
}
