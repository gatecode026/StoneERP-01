'use client';
import { useEffect, useState } from 'react';
import toast from '@/lib/toast';
import { Sheet, Field } from '@/components/ui';
import RuledField from '@/components/RuledField';
import DropFile from '@/components/papers/DropFile';
import { api } from '@/lib/client';
import { useApp } from '@/components/Providers';
import { todayISO } from '@/lib/format';
import T from '@/components/T';

export const CATEGORIES = ['Company', 'Licence', 'Machine', 'Vehicle', 'Insurance', 'Agreement', 'Loan', 'Other'];

const blank = (category) => ({ file: '', name: '', category: category || 'Company', issueDate: '', expiryDate: '', note: '', tags: '', originalAt: '' });

/** Add a paper or change one: the scan, the name, the folder, the dates, a description, tags and where the original is kept. */
export default function PaperSheet({ open, paper, defaultCategory, onClose, onSaved }) {
  const { tr } = useApp();
  const editing = Boolean(paper?._id);
  const [f, setF] = useState(blank(defaultCategory));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    if (!open) return;
    setShow(false);
    setF(paper?._id ? { file: paper.file || '', name: paper.name || '', category: paper.category || 'Company', issueDate: paper.issueDate || '', expiryDate: paper.expiryDate || '', note: paper.note || '', tags: (paper.tags || []).join(', '), originalAt: paper.originalAt || '' } : blank(defaultCategory));
  }, [open, paper, defaultCategory]);

  const today = todayISO();
  const tagList = f.tags.split(',').map((x) => x.trim()).filter(Boolean);
  const err = {
    file: !editing && !f.file ? 'Add the scan or photo of the paper' : '',
    name: !f.name.trim() ? 'Give the paper a name' : '',
    issue: f.issueDate && f.issueDate > today ? 'Issue date cannot be in the future' : '',
    expiry: f.issueDate && f.expiryDate && f.expiryDate < f.issueDate ? 'The paper expires before it was issued' : '',
    tags: tagList.length > 10 ? 'Up to 10 tags' : tagList.some((x) => x.length > 30) ? 'A tag can have up to 30 characters' : '',
  };

  async function save() {
    const bad = err.file || err.name || err.issue || err.expiry || err.tags;
    if (bad) { setShow(true); toast.error(bad); return; }
    setBusy(true);
    const body = { name: f.name.trim(), category: f.category, expiryDate: f.expiryDate || '', issueDate: f.issueDate || '', note: f.note.trim(), tags: tagList, originalAt: f.originalAt.trim(), ...(f.file || editing ? { file: f.file } : {}) };
    try {
      if (editing) await api(`/api/documents/${paper._id}`, { method: 'PATCH', body });
      else await api('/api/documents', { method: 'POST', body });
      toast.success(editing ? 'Paper saved' : 'Paper added');
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Change paper' : 'Add a paper'} wide
      footer={<><button className="btn-outline flex-1" onClick={onClose}><T>Cancel</T></button><button className="btn-primary flex-[2]" disabled={busy} onClick={save}>{tr(editing ? 'Save changes' : 'Save paper')}</button></>}>
      <div className="space-y-3.5">
        <Field label="Scan / photo / PDF" required={!editing}><DropFile value={f.file} onChange={(v) => set({ file: v })} error={show ? err.file : ''} /></Field>
        <RuledField rule="partyName" label="Paper name" required placeholder="e.g. Mining lease 2024-29" value={f.name} onChange={(v) => set({ name: v })} error={err.name} showError={show} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Folder" htmlFor="paper_cat"><select id="paper_cat" className="input" value={f.category} onChange={(e) => set({ category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label="Where the original is kept" htmlFor="paper_at"><input id="paper_at" className="input" maxLength={120} placeholder="e.g. Office locker 2" value={f.originalAt} onChange={(e) => set({ originalAt: e.target.value })} /></Field>
          <Field label="Issue date" htmlFor="paper_issue" error={show ? err.issue : ''}><input id="paper_issue" className="input" type="date" max={today} value={f.issueDate} onChange={(e) => set({ issueDate: e.target.value })} /></Field>
          <Field label="Expiry date (if any)" htmlFor="paper_exp" hint="Reminders go out 30 and 7 days before" error={show ? err.expiry : ''}><input id="paper_exp" className="input" type="date" value={f.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} /></Field>
        </div>
        <Field label="Description (optional)" htmlFor="paper_note"><textarea id="paper_note" className="input" rows={3} maxLength={500} placeholder={tr('A short note about the paper')} value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        <Field label="Tags (separated by commas)" htmlFor="paper_tags" error={show ? err.tags : ''} hint="e.g. mining, lease, renewal"><input id="paper_tags" className="input" value={f.tags} onChange={(e) => set({ tags: e.target.value })} /></Field>
      </div>
    </Sheet>
  );
}
