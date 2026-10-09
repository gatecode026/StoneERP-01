'use client';
import { Crown, Briefcase, Calculator, HardHat, Handshake, Wrench } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { ROLE_USERS } from '@/lib/perm';

const ROLES = [
  { key: 'owner', icon: Crown, desc: 'Everything, all approvals', descHi: 'सब कुछ, सभी मंज़ूरियाँ' },
  { key: 'manager', icon: Briefcase, desc: 'Daily entries, approvals up to a limit', descHi: 'दैनिक एंट्री, सीमा तक मंज़ूरी' },
  { key: 'accountant', icon: Calculator, desc: 'Sales, bills, expenses, salary sheet', descHi: 'बिक्री, बिल, खर्चे, वेतन शीट' },
  { key: 'supervisor', icon: HardHat, desc: 'Team attendance, daily work, machines', descHi: 'टीम हाज़िरी, दैनिक काम, मशीन' },
  { key: 'salesperson', icon: Handshake, desc: 'Customers, quotations, orders, stock', descHi: 'ग्राहक, कोटेशन, ऑर्डर, स्टॉक' },
  { key: 'worker', icon: Wrench, desc: 'Own report, attendance, salary slip', descHi: 'अपनी रिपोर्ट, हाज़िरी, वेतन पर्ची' },
];

export default function Login() {
  const { login, t, lang, setLang } = useApp();
  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex justify-end mb-2">
          <button onClick={() => setLang(lang === 'en' ? 'hi' : 'en')} className="h-9 px-3 rounded-lg border border-sand-300 bg-white text-xs font-bold">{lang === 'en' ? 'हिन्दी' : 'English'}</button>
        </div>
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-terra text-white flex items-center justify-center text-3xl font-bold shadow-md">V</div>
          <h1 className="text-2xl font-bold mt-3">{t('appName')}</h1>
          <div className="text-sm text-char-500">RD Natural Stones, Mandsaur · Bijoliya, Rajasthan</div>
          <span className="badge-amber mt-2">{t('demo')} · Basic ERP</span>
        </div>
        <p className="text-sm font-semibold text-char-700 mb-3 text-center">{t('chooseRole')}</p>
        <div className="space-y-2.5">
          {ROLES.map((r) => {
            const Icon = r.icon;
            return (
              <button key={r.key} onClick={() => login(r.key)} className="card w-full p-4 flex items-center gap-4 text-left hover:border-terra active:scale-[.99] transition min-h-[68px]">
                <div className="w-11 h-11 rounded-xl bg-terra-50 text-terra flex items-center justify-center shrink-0"><Icon size={22} /></div>
                <div className="min-w-0">
                  <div className="font-bold">{lang === 'hi' ? ROLE_USERS[r.key].hi : ROLE_USERS[r.key].name}{r.key === 'worker' && <span className="text-char-500 font-normal"> · Ramesh Meena</span>}</div>
                  <div className="text-xs text-char-500">{lang === 'hi' ? r.descHi : r.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-char-500 text-center mt-5">Demo login — no password. Each role sees only what its job needs.</p>
      </div>
    </div>
  );
}
