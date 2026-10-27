'use client';
import { useEffect, useState } from 'react';
import toast from '@/lib/toast';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Section, Field } from '@/components/ui';
import { useApp } from '@/components/Providers';
import { api } from '@/lib/client';
import T from '@/components/T';

// Settings → Working hours: shifts, weekly off, holidays, and the punching / pay rules that depend on them.
// Each card saves on its own, like the rest of the Settings screen.

const DAYS = [['sun', 'Sunday'], ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday']];
const OFF_RULES = [['none', 'Working day'], ['all', 'Off every week'], ['2nd4th', 'Off on the 2nd and 4th'], ['1st3rd5th', 'Off on the 1st, 3rd and 5th']];
const SHIFT_NUM = [
  ['breakMinutes', 'Break (minutes)', 'Taken off the hours worked'], ['graceMinutes', 'Late after (minutes)', 'Coming within this of the start is not late'],
  ['fullDayHours', 'Full day (hours worked)', 'At least this = a full day'], ['halfDayHours', 'Half day (hours worked)', 'At least this = half day, less = absent'],
  ['otBufferMinutes', 'Overtime starts after (minutes)', 'Staying less than this past the end earns nothing'], ['otRoundMinutes', 'Count overtime in blocks of (minutes)', 'Rounded down to whole blocks'],
];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'shift';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function SaveBtn({ dirty, busy, onClick }) {
  return <button className="btn-primary btn-sm" disabled={!dirty || busy} onClick={onClick}><Save size={14} /> {busy ? '…' : <T>Save</T>}</button>;
}

function useCard(value, apply) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  // start again from the saved values when THEY change. The cards pass a freshly built object on every render, so its identity says nothing:
  // keying on the object made this effect run on every render, set the draft, render again... without end
  const saved = JSON.stringify(value);
  useEffect(() => { setDraft(JSON.parse(saved)); }, [saved]);
  const dirty = !same(draft, value);
  async function save(body, onSaved) {
    setBusy(true);
    try { await api('/api/settings', { method: 'PUT', body: { workHours: body } }); toast.success('Saved'); onSaved(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  }
  return { draft, setDraft, dirty, busy, save, apply };
}

function ShiftsCard({ wh, onSaved }) {
  const { tr } = useApp();
  const c = useCard({ shifts: wh.shifts, defaultShiftId: wh.defaultShiftId }, onSaved);
  const { draft, setDraft } = c;
  const upd = (i, patch) => setDraft({ ...draft, shifts: draft.shifts.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const add = () => {
    let id = 'shift';
    for (let n = draft.shifts.length + 1; draft.shifts.some((s) => s.id === id) || id === 'shift'; n++) id = `shift${n}`;
    setDraft({ ...draft, shifts: [...draft.shifts, { id, name: tr('New shift'), start: '09:00', end: '18:00', breakMinutes: 60, graceMinutes: 10, fullDayHours: 7, halfDayHours: 4, otBufferMinutes: 30, otRoundMinutes: 30 }] });
  };
  const remove = (i) => {
    const gone = draft.shifts[i];
    const rest = draft.shifts.filter((_, k) => k !== i);
    setDraft({ shifts: rest, defaultShiftId: draft.defaultShiftId === gone.id ? rest[0]?.id ?? '' : draft.defaultShiftId });
  };
  const save = () => {
    const shifts = draft.shifts.map((s) => ({ ...s, id: slug(s.id), name: s.name.trim(), breakMinutes: Number(s.breakMinutes), graceMinutes: Number(s.graceMinutes), fullDayHours: Number(s.fullDayHours), halfDayHours: Number(s.halfDayHours), otBufferMinutes: Number(s.otBufferMinutes), otRoundMinutes: Number(s.otRoundMinutes) }));
    return c.save({ shifts, defaultShiftId: draft.defaultShiftId }, onSaved);
  };
  return (
    <Section title="Shifts" right={<SaveBtn dirty={c.dirty} busy={c.busy} onClick={save} />}>
      <p className="text-xs text-char-500 -mt-1 mb-3"><T>A shift that ends earlier than it starts (for example 21:00 to 06:00) is a night shift: the day belongs to the evening it starts. Everyone works the default shift unless their profile names another.</T></p>
      <div className="space-y-3">
        {draft.shifts.map((s, i) => (
          <div key={s.id + i} className="rounded-none border border-sand-300 p-3">
            <div className="grid sm:grid-cols-4 gap-3">
              <Field label="Shift name" htmlFor={`sh_name_${i}`} className="sm:col-span-2"><input id={`sh_name_${i}`} className="input" value={s.name} maxLength={40} onChange={(e) => upd(i, { name: e.target.value })} /></Field>
              <Field label="Starts" htmlFor={`sh_start_${i}`}><input id={`sh_start_${i}`} type="time" className="input" value={s.start} onChange={(e) => upd(i, { start: e.target.value })} /></Field>
              <Field label="Ends" htmlFor={`sh_end_${i}`}><input id={`sh_end_${i}`} type="time" className="input" value={s.end} onChange={(e) => upd(i, { end: e.target.value })} /></Field>
              {SHIFT_NUM.map(([k, label, hint]) => (
                <Field key={k} label={label} hint={hint} htmlFor={`sh_${k}_${i}`}>
                  <input id={`sh_${k}_${i}`} type="number" min="0" step={k.endsWith('Hours') ? '0.5' : '1'} inputMode="decimal" className="input" value={s[k]} onChange={(e) => upd(i, { [k]: e.target.value })} />
                </Field>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3 gap-2">
              <label className="flex items-center gap-2 text-sm font-medium min-h-[44px]">
                <input type="radio" name="defaultShift" className="h-5 w-5 accent-[#8A5C38]" checked={draft.defaultShiftId === s.id} onChange={() => setDraft({ ...draft, defaultShiftId: s.id })} /> <T>Default shift</T>
              </label>
              {draft.shifts.length > 1 && <button type="button" className="btn-outline btn-sm" onClick={() => remove(i)}><Trash2 size={14} /><T> Remove</T></button>}
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn-outline btn-sm mt-3" onClick={add} disabled={draft.shifts.length >= 10}><Plus size={14} /><T> Add a shift</T></button>
    </Section>
  );
}

function WeekOffCard({ wh, onSaved }) {
  const { tr } = useApp();
  const c = useCard(wh.weekOff, onSaved);
  const { draft, setDraft } = c;
  return (
    <Section title="Weekly off" right={<SaveBtn dirty={c.dirty} busy={c.busy} onClick={() => c.save({ weekOff: draft }, onSaved)} />}>
      <p className="text-xs text-char-500 -mt-1 mb-3"><T>Choose the days nobody has to come. For alternate Saturdays pick "Off on the 2nd and 4th". Monthly-paid staff lose no pay on these days; anyone who works on one gets the hours as overtime.</T></p>
      <div className="grid sm:grid-cols-2 gap-3">
        {DAYS.map(([k, label]) => (
          <Field key={k} label={label} htmlFor={`wo_${k}`}>
            <select id={`wo_${k}`} className="input" value={draft[k] || 'none'} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}>
              {OFF_RULES.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
            </select>
          </Field>
        ))}
      </div>
    </Section>
  );
}

function HolidaysCard({ wh, onSaved }) {
  const c = useCard(wh.holidays, onSaved);
  const { draft, setDraft } = c;
  const upd = (i, patch) => setDraft(draft.map((h, k) => (k === i ? { ...h, ...patch } : h)));
  const sorted = [...draft].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Section title="Holidays" right={<SaveBtn dirty={c.dirty} busy={c.busy} onClick={() => c.save({ holidays: sorted.map((h) => ({ date: h.date, endDate: h.endDate || '', name: h.name.trim() })) }, onSaved)} />}>
      <p className="text-xs text-char-500 -mt-1 mb-3"><T>Festival and company holidays. A holiday of several days is one line with an end date. Nobody is marked absent on a holiday.</T></p>
      {!draft.length && <div className="text-sm text-char-500 py-2"><T>No holidays added yet.</T></div>}
      <div className="space-y-2">
        {draft.map((h, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-[9rem_9rem_1fr_auto] gap-2 items-end">
            <Field label="From" htmlFor={`hd_from_${i}`}><input id={`hd_from_${i}`} type="date" className="input" value={h.date} onChange={(e) => upd(i, { date: e.target.value })} /></Field>
            <Field label="To (optional)" htmlFor={`hd_to_${i}`}><input id={`hd_to_${i}`} type="date" className="input" value={h.endDate || ''} min={h.date} onChange={(e) => upd(i, { endDate: e.target.value })} /></Field>
            <Field label="Name" htmlFor={`hd_name_${i}`} className="col-span-2 sm:col-span-1"><input id={`hd_name_${i}`} className="input" value={h.name} maxLength={60} onChange={(e) => upd(i, { name: e.target.value })} /></Field>
            <button type="button" className="btn-outline btn-sm col-span-2 sm:col-span-1" onClick={() => setDraft(draft.filter((_, k) => k !== i))} aria-label="Remove"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <button type="button" className="btn-outline btn-sm mt-3" onClick={() => setDraft([...draft, { date: '', endDate: '', name: '' }])} disabled={draft.length >= 120}><Plus size={14} /><T> Add a holiday</T></button>
    </Section>
  );
}

function RulesCard({ wh, onSaved }) {
  const pick = { paidWeekOff: wh.paidWeekOff, appPunching: wh.appPunching, punchGapMinutes: wh.punchGapMinutes, openDayAfterHours: wh.openDayAfterHours };
  const c = useCard(pick, onSaved);
  const { draft, setDraft } = c;
  const save = () => c.save({ paidWeekOff: !!draft.paidWeekOff, appPunching: !!draft.appPunching, punchGapMinutes: Number(draft.punchGapMinutes), openDayAfterHours: Number(draft.openDayAfterHours) }, onSaved);
  return (
    <Section title="Punching and pay rules" right={<SaveBtn dirty={c.dirty} busy={c.busy} onClick={save} />}>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex items-center gap-2.5 min-h-[44px] text-sm font-medium sm:col-span-2">
          <input type="checkbox" className="h-5 w-5 rounded-none accent-[#8A5C38]" checked={!!draft.paidWeekOff} onChange={(e) => setDraft({ ...draft, paidWeekOff: e.target.checked })} /> <T>Monthly-paid staff are paid for weekly offs and holidays</T>
        </label>
        <label className="flex items-center gap-2.5 min-h-[44px] text-sm font-medium sm:col-span-2">
          <input type="checkbox" className="h-5 w-5 rounded-none accent-[#8A5C38]" checked={!!draft.appPunching} onChange={(e) => setDraft({ ...draft, appPunching: e.target.checked })} /> <T>Allow Punch In / Out buttons in the app (for testing; switch off when the biometric machine is in use)</T>
        </label>
        <Field label="Ignore a repeat punch within (minutes)" hint="Stops an accidental double tap" htmlFor="pr_gap"><input id="pr_gap" type="number" min="0" max="60" className="input" value={draft.punchGapMinutes} onChange={(e) => setDraft({ ...draft, punchGapMinutes: e.target.value })} /></Field>
        <Field label="Flag a missing Out this many hours after the shift ends" hint="The day then shows in 'Needs a fix'" htmlFor="pr_open"><input id="pr_open" type="number" min="0" max="24" step="0.5" className="input" value={draft.openDayAfterHours} onChange={(e) => setDraft({ ...draft, openDayAfterHours: e.target.value })} /></Field>
      </div>
      <p className="text-xs text-char-500 mt-3"><T>Overtime is always paid only after a Manager or the Owner approves it on the Attendance screen.</T></p>
    </Section>
  );
}

export default function WorkHoursCards({ value, onSaved }) {
  if (!value) return null;
  return (
    <>
      <ShiftsCard wh={value} onSaved={onSaved} />
      <WeekOffCard wh={value} onSaved={onSaved} />
      <HolidaysCard wh={value} onSaved={onSaved} />
      <RulesCard wh={value} onSaved={onSaved} />
    </>
  );
}
