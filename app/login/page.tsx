'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Smartphone,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Package,
  FileText,
  Users,
  BarChart3,
  X,
  Languages,
} from 'lucide-react';
import { useApp } from '@/components/Providers';
import { api } from '@/lib/client';

function VipulLogoMark({ className = 'w-12 h-10' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Faceted geometric stone peak / mountain */}
      <polygon points="50,4 28,34 50,38" fill="#D8C8B5" />
      <polygon points="50,4 72,34 50,38" fill="#C2AB92" />
      <polygon points="12,50 28,34 50,38" fill="#AB9176" />
      <polygon points="88,50 72,34 50,38" fill="#957A60" />
      <polygon points="12,50 50,74 50,38" fill="#8B7057" />
      <polygon points="88,50 50,74 50,38" fill="#785D44" />
      <polygon points="26,74 50,74 50,38" fill="#A1866C" />
      <polygon points="74,74 50,74 50,38" fill="#80654D" />
      {/* Sheen reflection */}
      <polygon points="50,4 38,36 50,38" fill="#F2E8DC" opacity="0.65" />
      <polygon points="50,4 62,36 50,38" fill="#695139" opacity="0.25" />
    </svg>
  );
}

const TEXTS = {
  en: {
    heroTitle1: 'Powering Your Stone Business',
    heroTitle2: 'with Smarter Solutions',
    heroDesc:
      'From quarry to your destination — we provide premium natural stones and now, a smarter way to manage your business with our ERP system.',
    f1Title: 'Inventory Management',
    f1Desc: 'Track stock & materials',
    f2Title: 'Order Tracking',
    f2Desc: 'From inquiry to delivery',
    f3Title: 'Supplier & Customer Management',
    f3Desc: 'Stronger partnerships',
    f4Title: 'Reports & Analytics',
    f4Desc: 'Better decisions',
    welcomeBack: 'Welcome Back',
    signInSubtitle: 'Sign in to your account to continue',
    phoneLabel: 'Mobile number or email',
    phonePlaceholder: 'Mobile number or email',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Enter your password',
    rememberMe: 'Remember me',
    forgotPassword: 'Forgot password?',
    loginBtn: 'Login',
    signingIn: 'Signing in…',
    copyright: '© 2025 Vipul Stone Suppliers. All rights reserved.',
    forgotTitle: 'Need Password Help?',
    forgotBody:
      'For business security, password resets are handled directly by the Owner / System Administrator. Please contact management to reset your credentials.',
    close: 'Close',
  },
  hi: {
    heroTitle1: 'स्टोन व्यापार को दें नई गति',
    heroTitle2: 'स्मार्ट और आधुनिक समाधान',
    heroDesc:
      'खदान से गंतव्य तक — हम उच्च गुणवत्ता वाले प्राकृतिक पत्थर और आपके व्यवसाय को सुचारू रूप से चलाने हेतु आधुनिक ईआरपी सिस्टम प्रदान करते हैं।',
    f1Title: 'इन्वेंट्री प्रबंधन',
    f1Desc: 'स्टॉक और सामग्री ट्रैकिंग',
    f2Title: 'ऑर्डर ट्रैकिंग',
    f2Desc: 'पूछताछ से डिलीवरी तक',
    f3Title: 'सप्लायर और ग्राहक प्रबंधन',
    f3Desc: 'मजबूत व्यावसायिक संबंध',
    f4Title: 'रिपोर्ट्स और एनालिटिक्स',
    f4Desc: 'सटीक और तेज़ निर्णय',
    welcomeBack: 'वापसी पर स्वागत है',
    signInSubtitle: 'जारी रखने के लिए अपने खाते में साइन इन करें',
    phoneLabel: 'मोबाइल नंबर या ईमेल',
    phonePlaceholder: 'मोबाइल नंबर या ईमेल',
    passwordLabel: 'पासवर्ड',
    passwordPlaceholder: 'अपना पासवर्ड दर्ज करें',
    rememberMe: 'मुझे याद रखें',
    forgotPassword: 'पासवर्ड भूल गए?',
    loginBtn: 'लॉगिन',
    signingIn: 'साइन इन हो रहा है…',
    copyright: '© 2025 विपुल स्टोन सप्लायर्स। सर्वाधिकार सुरक्षित।',
    forgotTitle: 'पासवर्ड रीसेट सहायता',
    forgotBody:
      'सुरक्षा के लिए पासवर्ड रीसेट केवल एडमिन / मालिक द्वारा किया जाता है। कृपया अपने व्यवस्थापक से संपर्क करें।',
    close: 'बंद करें',
  },
};

export default function LoginPage() {
  const { lang, setLang } = useApp();
  const router = useRouter();
  const t = TEXTS[lang as 'en' | 'hi'] ?? TEXTS.en;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showForgotModal, setShowForgotModal] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');

    try {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: { username: username.trim(), password },
      });
      router.replace(res.mustChangePassword ? '/change-password' : '/');
      router.refresh();
    } catch (err) {
      setError((err as Error).message || 'Invalid credentials. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div
      suppressHydrationWarning
      className="fixed inset-0 w-screen h-screen overflow-hidden bg-[#F4F5F7] flex flex-col lg:flex-row font-sans select-none"
    >
      {/* Top right language switch pill */}
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-40">
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-md border border-gray-200/90 text-xs font-semibold text-gray-700 shadow-sm hover:bg-white hover:border-gray-300 transition cursor-pointer"
          title="Toggle Language"
        >
          <Languages className="w-3.5 h-3.5 text-[#A08368]" />
          <span>{lang === 'en' ? 'हिन्दी' : 'English'}</span>
        </button>
      </div>

      {/* LEFT SECTION: Brand Hero & Quarry Background */}
      <section className="relative hidden md:flex flex-1 h-full flex-col justify-between p-6 sm:p-8 lg:p-10 xl:p-14 overflow-hidden">
        {/* Background Image with cache-busting to ensure latest sky image */}
        <div
          className="absolute inset-0 bg-cover bg-[position:center_32%] transition-all duration-700"
          style={{ backgroundImage: `url('/login-bg.jpg?v=3')` }}
        />
        {/* Top soft gradient for clear typography */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/80 via-white/40 via-35% to-transparent pointer-events-none" />
        {/* Bottom dark shadow gradient over the marble slabs */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 via-45% to-transparent pointer-events-none" />

        {/* Content Layer */}
        <div className="relative z-10 flex flex-col justify-between h-full">
          {/* Top Brand Logo */}
          <div className="flex flex-col items-start">
            <VipulLogoMark className="w-12 h-9 sm:w-14 sm:h-11" />
            <span className="text-xs sm:text-sm font-black tracking-[0.24em] text-gray-900 uppercase mt-1">
              VIPUL
            </span>
            <span className="text-[9px] sm:text-[10px] font-semibold tracking-[0.28em] text-gray-600 uppercase">
              STONE SUPPLIERS
            </span>
          </div>

          {/* Hero Headline & Subtext */}
          <div className="max-w-xl my-auto py-4">
            <h1 className="text-2xl sm:text-3xl lg:text-[36px] xl:text-[42px] font-extrabold text-[#192231] leading-[1.18] tracking-tight">
              {t.heroTitle1}{' '}
              <span className="text-[#A08368] block sm:inline">{t.heroTitle2}</span>
            </h1>
            <p className="mt-3 text-xs sm:text-sm lg:text-base text-gray-700 leading-relaxed font-normal max-w-lg">
              {t.heroDesc}
            </p>
          </div>

          {/* Bottom Feature Badges & Footer */}
          <div className="space-y-4">
            {/* 4 Feature Items */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 xl:gap-5">
              {/* Feature 1 */}
              <div className="flex flex-col space-y-0.5">
                <div className="text-white/95 mb-1">
                  <Package className="w-5 h-5 stroke-[1.75]" />
                </div>
                <h2 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                  {t.f1Title}
                </h2>
                <p className="text-[10px] sm:text-[11px] text-stone-300 leading-snug">{t.f1Desc}</p>
              </div>

              {/* Feature 2 */}
              <div className="flex flex-col space-y-0.5">
                <div className="text-white/95 mb-1">
                  <FileText className="w-5 h-5 stroke-[1.75]" />
                </div>
                <h2 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                  {t.f2Title}
                </h2>
                <p className="text-[10px] sm:text-[11px] text-stone-300 leading-snug">{t.f2Desc}</p>
              </div>

              {/* Feature 3 */}
              <div className="flex flex-col space-y-0.5">
                <div className="text-white/95 mb-1">
                  <Users className="w-5 h-5 stroke-[1.75]" />
                </div>
                <h2 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                  {t.f3Title}
                </h2>
                <p className="text-[10px] sm:text-[11px] text-stone-300 leading-snug">{t.f3Desc}</p>
              </div>

              {/* Feature 4 */}
              <div className="flex flex-col space-y-0.5">
                <div className="text-white/95 mb-1">
                  <BarChart3 className="w-5 h-5 stroke-[1.75]" />
                </div>
                <h2 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                  {t.f4Title}
                </h2>
                <p className="text-[10px] sm:text-[11px] text-stone-300 leading-snug">{t.f4Desc}</p>
              </div>
            </div>

            {/* Bottom Brand Line */}
            <div className="flex items-center gap-2.5 pt-3 border-t border-white/20">
              <span className="text-[10px] sm:text-xs font-semibold tracking-[0.2em] text-white/90 uppercase whitespace-nowrap">
                VIPUL STONE SUPPLIERS
              </span>
              <span className="text-white/40 text-xs">|</span>
              <span className="text-[10px] sm:text-xs font-semibold tracking-[0.2em] text-white/90 uppercase whitespace-nowrap">
                ERP SYSTEM
              </span>
              <div className="h-[1px] bg-white/20 flex-1 max-w-[100px] hidden sm:block" />
            </div>
          </div>
        </div>
      </section>

      {/* RIGHT SECTION: Single-frame Centered Clean Card */}
      <section className="relative w-full md:w-[420px] lg:w-[460px] xl:w-[490px] h-full flex items-center justify-center p-4 sm:p-6 lg:p-8 shrink-0 bg-[#F4F5F7] overflow-hidden">
        {/* On very small screens (< md), show soft blurred backdrop */}
        <div
          className="absolute inset-0 md:hidden bg-cover bg-center opacity-20 pointer-events-none"
          style={{ backgroundImage: `url('/login-bg.jpg?v=3')` }}
        />

        <div className="relative z-10 w-full max-w-[390px] lg:max-w-[420px] bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 lg:p-7 xl:p-8 shadow-[0_12px_40px_rgba(0,0,0,0.06)] border border-gray-100 flex flex-col justify-between">
          {/* Card Header with Centered Faceted Logo */}
          <div className="flex flex-col items-center text-center">
            <VipulLogoMark className="w-14 h-10 sm:w-16 sm:h-11" />
            <span className="text-xs sm:text-sm font-black tracking-[0.22em] text-gray-900 uppercase mt-0.5">
              VIPUL
            </span>
            <span className="text-[8px] sm:text-[9px] font-semibold tracking-[0.28em] text-gray-500 uppercase">
              STONE SUPPLIERS
            </span>

            {/* ERP SYSTEM flanked by subtle accent lines */}
            <div className="flex items-center justify-center gap-2.5 w-full my-2.5">
              <div className="h-[1px] w-10 bg-gray-200" />
              <span className="text-[9px] sm:text-[10px] font-semibold tracking-[0.24em] text-gray-400 uppercase">
                ERP SYSTEM
              </span>
              <div className="h-[1px] w-10 bg-gray-200" />
            </div>
          </div>

          {/* Heading */}
          <div className="mt-1 mb-4 text-left">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
              {t.welcomeBack}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{t.signInSubtitle}</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            {/* Phone Number Input */}
            <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 transition focus-within:border-[#A08368] focus-within:ring-2 focus-within:ring-[#A08368]/20">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <label htmlFor="username" className="block text-[10px] font-medium text-gray-500 leading-tight">
                    {t.phoneLabel}
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={120}
                    placeholder={t.phonePlaceholder}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-transparent text-sm font-medium text-gray-900 placeholder:text-gray-300 focus:outline-none"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Password Input */}
            <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 transition focus-within:border-[#A08368] focus-within:ring-2 focus-within:ring-[#A08368]/20">
              <div className="flex items-center gap-2.5">
                <Lock className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <label htmlFor="password" className="block text-[10px] font-medium text-gray-500 leading-tight">
                    {t.passwordLabel}
                  </label>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-transparent text-sm font-medium text-gray-900 placeholder:text-gray-300 focus:outline-none"
                    required
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="p-1 text-gray-400 hover:text-gray-600 transition"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4 text-gray-500" />
                  ) : (
                    <Eye className="w-4 h-4 text-gray-500" />
                  )}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div
                role="alert"
                className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 flex items-start gap-2"
              >
                <span>{error}</span>
              </div>
            )}

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between text-xs pt-0.5">
              <label className="flex items-center gap-2 cursor-pointer select-none text-gray-600">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-[#A08368] accent-[#A08368] focus:ring-[#A08368]"
                />
                <span className="font-medium text-gray-700">{t.rememberMe}</span>
              </label>

              <button
                type="button"
                onClick={() => setShowForgotModal(true)}
                className="text-gray-500 hover:text-[#A08368] font-medium transition cursor-pointer"
              >
                {t.forgotPassword}
              </button>
            </div>

            {/* Submit Button */}
            <div className="pt-1.5">
              <button
                type="submit"
                disabled={busy || !username.trim() || !password}
                className="w-full flex items-center justify-center gap-2 py-2.5 sm:py-3 px-4 rounded-xl bg-[#A08368] hover:bg-[#8F7257] active:bg-[#7D6248] text-white text-sm font-semibold shadow-sm transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                <span>{busy ? t.signingIn : t.loginBtn}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Divider & Copyright */}
            <div className="pt-3.5 mt-3.5 border-t border-gray-100 text-center">
              <p className="text-[10px] sm:text-[11px] text-gray-400 font-normal">{t.copyright}</p>
            </div>
          </form>
        </div>
      </section>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">{t.forgotTitle}</h3>
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">{t.forgotBody}</p>
            <button
              type="button"
              onClick={() => setShowForgotModal(false)}
              className="w-full py-2.5 rounded-xl bg-[#A08368] hover:bg-[#8F7257] text-white text-xs sm:text-sm font-semibold transition cursor-pointer"
            >
              {t.close}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
