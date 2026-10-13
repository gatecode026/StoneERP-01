'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { api } from '@/lib/client';

const T = {
  en: { title: 'Sign in', mobile: 'Mobile number', password: 'Password', show: 'Show password', hide: 'Hide password', go: 'Sign in', wait: 'Signing in…', help: 'Forgot your password? Ask the Owner to reset it for you.', sub: 'RD Natural Stones, Mandsaur · Bijoliya, Rajasthan' },
  hi: { title: 'साइन इन', mobile: 'मोबाइल नंबर', password: 'पासवर्ड', show: 'पासवर्ड दिखाएँ', hide: 'पासवर्ड छुपाएँ', go: 'साइन इन करें', wait: 'साइन इन हो रहा है…', help: 'पासवर्ड भूल गए? मालिक से रीसेट करवाएँ।', sub: 'आरडी नेचुरल स्टोन्स, मंदसौर · बिजोलिया, राजस्थान' },
};

export default function Login() {
  const { lang, setLang } = useApp();
  const router = useRouter();
  const t = T[lang as 'en' | 'hi'] ?? T.en;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { username, password } });
      router.replace(r.mustChangePassword ? '/change-password' : '/');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex justify-end mb-2">
          <button type="button" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')} className="h-11 px-4 rounded-lg border border-sand-300 bg-white text-sm font-bold">{lang === 'en' ? 'हिन्दी' : 'English'}</button>
        </div>
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-terra text-white flex items-center justify-center text-3xl font-bold shadow-md" aria-hidden>V</div>
          <h1 className="text-2xl font-bold mt-3">{lang === 'hi' ? 'विपुल स्टोन सप्लायर्स' : 'Vipul Stone Suppliers'}</h1>
          <div className="text-sm text-char-500">{t.sub}</div>
        </div>
        <form onSubmit={submit} className="card p-5 space-y-4" noValidate>
          <h2 className="font-bold text-lg">{t.title}</h2>
          <div>
            <label htmlFor="username" className="label">{t.mobile}</label>
            <input id="username" name="username" className="input text-lg" type="tel" inputMode="numeric" autoComplete="username" maxLength={14} value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="password" className="label">{t.password}</label>
            <div className="relative">
              <input id="password" name="password" className="input text-lg pr-12" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? t.hide : t.show} className="absolute right-0 top-0 h-11 w-11 flex items-center justify-center text-char-500">
                {show ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>
          {error && <div role="alert" className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
          <button className="btn-primary w-full !min-h-[52px] text-base" disabled={busy || !username || !password}><LogIn size={18} /> {busy ? t.wait : t.go}</button>
          <p className="text-xs text-char-500 text-center">{t.help}</p>
        </form>
      </div>
    </div>
  );
}
