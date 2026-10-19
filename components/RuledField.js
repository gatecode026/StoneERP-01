'use client';
import { useId, useState } from 'react';
import { Field, cx } from '@/components/ui';
import { EMPLOYEE_RULES } from '@/lib/validators';

/**
 * A text input for the screens that are not built from a field list (the payment and dispatch sheets, the quotation form).
 * It follows the same rule table as the forms: what is typed is tidied on every key (a mobile number takes digits only),
 * finished when the person leaves the field, and the rule's message shows under it. `error` lets the screen add its own
 * message (a rule that looks at other fields); `showError` shows messages before the field has been left (on Save).
 */
export default function RuledField({ rule, label, value, onChange, required, hint, error, showError, className, type, id, placeholder, disabled }) {
  const r = EMPLOYEE_RULES[rule];
  const [touched, setTouched] = useState(false);
  const auto = useId();
  const fid = id || auto; // the label is tied to its input (screen readers, and tests that find a field by its label)
  const own = (touched || showError) && value ? r.check(value) : '';
  const shown = own || ((touched || showError) ? error : '') || '';
  return (
    <Field label={label} required={required} hint={hint} error={shown} className={className} htmlFor={fid}>
      <input id={fid} className={cx('input', shown && '!border-red-500')} type={type || 'text'} inputMode={r.inputMode} autoCapitalize={r.autoCapitalize} spellCheck={false}
        value={value || ''} placeholder={placeholder} disabled={disabled} aria-invalid={shown ? true : undefined}
        onChange={(e) => onChange(r.live(e.target.value))}
        onBlur={() => { if (value) onChange(r.clean(value)); setTouched(true); }} />
    </Field>
  );
}

/** The message for a rule, or '' when the value is fine or empty (for a screen that wants to stop a Save). */
export const ruleProblem = (rule, value) => (value ? EMPLOYEE_RULES[rule].check(value) : '');
