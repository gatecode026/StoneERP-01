'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import toast from '@/lib/toast';
import { useApp } from '@/components/Providers';
import { api } from '@/lib/client';

const T = {
  en: { title: 'Set a new password', sub: 'For your safety, choose a password only you know.', cur: 'Current (temporary) password', nw: 'New password', again: 'Type the new password again', rule: 'At least 8 characters, with letters and numbers.', mismatch: 'The two new passwords are not the same', go: 'Save and continue', done: 'Password changed', out: 'Sign out' },
  hi: { title: 'नया पासवर्ड बनाएँ', sub: 'अपनी सुरक्षा के लिए ऐसा पासवर्ड चुनें जो सिर्फ़ आपको पता हो।', cur: 'मौजूदा (अस्थायी) पासवर्ड', nw: 'नया पासवर्ड', again: 'नया पासवर्ड फिर से लिखें', rule: 'कम से कम 8 अक्षर, अक्षर और अंक दोनों।', mismatch: 'दोनों नए पासवर्ड एक जैसे नहीं हैं', go: 'सेव करें और आगे बढ़ें', done: 'पासवर्ड बदल गया', out: 'साइन आउट' },
};

export default function ChangePassword() {
  const { lang, logout } = useApp();
  const router = useRouter();
  const t = T[lang as 'en' | 'hi'] ?? T.en;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (next !== again) { setError(t.mismatch); return; }
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { current, next } });
      toast.success(t.done);
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8">
      <form onSubmit={submit} className="card p-5 space-y-4 w-full max-w-md" noValidate>
        <div className="flex items-center gap-2"><KeyRound className="text-terra" /><h1 className="font-bold text-xl">{t.title}</h1></div>
        <p className="text-sm text-char-500">{t.sub}</p>
        <div><label htmlFor="cur" className="label">{t.cur}</label><input id="cur" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></div>
        <div><label htmlFor="new" className="label">{t.nw}</label><input id="new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /><div className="text-[11px] text-char-500 mt-1">{t.rule}</div></div>
        <div><label htmlFor="again" className="label">{t.again}</label><input id="again" className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></div>
        {error && <div role="alert" className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <button className="btn-primary w-full !min-h-[52px]" disabled={busy || !current || !next || !again}>{t.go}</button>
        <button type="button" className="btn-ghost w-full" onClick={logout}>{t.out}</button>
      </form>
    </div>
  );
}
