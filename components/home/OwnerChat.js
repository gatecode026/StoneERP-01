'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, X, RotateCcw } from 'lucide-react';
import { api } from '@/lib/client';
import { cx } from '@/components/ui';
import { useH } from './strings';

/**
 * The Owner's dashboard assistant. Only OwnerHome renders it, and /api/assistant refuses everyone else on the server.
 * Replies are plain text (never HTML), so nothing the model writes can run in the page.
 */
export default function OwnerChat({ date }) {
  const h = useH();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages, busy, open]);

  async function send(q) {
    const content = String(q ?? text).trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setText('');
    setBusy(true);
    try {
      const r = await api('/api/assistant', { method: 'POST', body: { messages: next.slice(-10), date } });
      setMessages([...next, { role: 'assistant', content: r.reply }]);
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: e.message, error: true }]);
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label={h('chatTitle')} title={h('chatTitle')}
        className="group fixed right-4 bottom-[164px] md:bottom-6 z-40 no-print w-11 h-11 rounded-full bg-gradient-to-br from-terra to-terra-700 text-white shadow-lg ring-4 ring-terra/15 flex items-center justify-center hover:scale-105 hover:ring-terra/25 active:scale-95 transition">
        <Sparkles size={19} />
        <span className="hidden md:block pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-lg bg-char text-white text-xs font-medium px-2.5 py-1.5 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 transition">{h('chatTitle')}</span>
      </button>
    );
  }

  return (
    <div role="dialog" aria-label={h('chatTitle')}
      className="fixed z-50 no-print inset-x-0 bottom-0 md:inset-x-auto md:right-6 md:bottom-6 md:w-[400px] h-[78vh] md:h-[560px] bg-white border border-stone-200 rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col sheet-enter">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-stone-100">
        <div className="min-w-0">
          <div className="font-bold text-sm truncate">{h('chatTitle')}</div>
          <div className="text-[11px] text-char-500 truncate">{h('chatHint')}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {messages.length > 0 && <button type="button" className="icon-btn" title={h('chatClear')} aria-label={h('chatClear')} onClick={() => setMessages([])}><RotateCcw size={16} /></button>}
          <button type="button" className="icon-btn" title={h('chatClose')} aria-label={h('chatClose')} onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {['chatQ1', 'chatQ2', 'chatQ3', 'chatQ4'].map((k) => (
              <button key={k} type="button" className="badge-gray !rounded-xl !py-1.5 text-left font-medium hover:bg-stone-200" onClick={() => send(h(k))}>{h(k)}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cx('max-w-[88%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words',
              m.role === 'user' ? 'bg-terra text-white' : m.error ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-stone-100 text-char')}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-char-500" role="status">{h('chatThinking')}</div>}
        <div ref={end} />
      </div>

      <form className="flex items-center gap-2 p-3 border-t border-stone-100 safe-pb" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input className="input" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder={h('chatPlaceholder')} aria-label={h('chatPlaceholder')} />
        <button type="submit" className="btn-primary shrink-0 !px-3" disabled={busy || !text.trim()} aria-label={h('chatSend')}><Send size={16} /></button>
      </form>
    </div>
  );
}
