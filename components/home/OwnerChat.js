'use client';
import { useEffect, useRef, useState } from 'react';
import { Send, X, RotateCcw } from 'lucide-react';
import { api } from '@/lib/client';
import { cx } from '@/components/ui';
import { useH } from './strings';
import ChatbotIcon from '@/components/ChatbotIcon';

/**
 * The Owner's dashboard assistant. Flat styling, zero radius, zero gradients, stone-brown brand colors.
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={h('chatTitle')}
        title={h('chatTitle')}
        className="fixed right-4 bottom-20 md:bottom-6 md:right-6 z-40 no-print w-12 h-12 rounded-none bg-[#8A5C38] text-white shadow-none border border-[#7D5333] flex items-center justify-center hover:bg-[#7D5333] active:bg-[#684124] transition"
      >
        <ChatbotIcon size={28} variant="white" />
      </button>
    );
  }

  return (
    <div role="dialog" aria-label={h('chatTitle')}
      className="fixed z-50 no-print inset-x-0 bottom-0 md:inset-x-auto md:right-6 md:bottom-6 md:w-[400px] h-[78vh] md:h-[540px] bg-white border border-slate-300 rounded-none shadow-none flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-sand-300 bg-[#FAF7F2]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-none bg-[#8A5C38] border border-[#7D5333] flex items-center justify-center shrink-0">
            <ChatbotIcon size={20} variant="white" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm truncate text-slate-900">{h('chatTitle')}</div>
            <div className="text-[11px] text-slate-500 truncate">{h('chatHint')}</div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {messages.length > 0 && <button type="button" className="p-1 rounded-none hover:bg-slate-200 text-slate-600" title={h('chatClear')} aria-label={h('chatClear')} onClick={() => setMessages([])}><RotateCcw size={15} /></button>}
          <button type="button" className="p-1 rounded-none hover:bg-slate-200 text-slate-600" title={h('chatClose')} aria-label={h('chatClose')} onClick={() => setOpen(false)}><X size={16} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {['chatQ1', 'chatQ2', 'chatQ3', 'chatQ4'].map((k) => (
              <button key={k} type="button" className="rounded-none border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs text-left font-medium text-slate-700 hover:bg-slate-100" onClick={() => send(h(k))}>{h(k)}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cx('flex items-start gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role !== 'user' && (
              <div className="w-6 h-6 rounded-none bg-[#FAF7F2] border border-sand-300 flex items-center justify-center shrink-0 mt-0.5">
                <ChatbotIcon size={16} variant="brand" />
              </div>
            )}
            <div className={cx('max-w-[85%] rounded-none px-3.5 py-2 text-sm whitespace-pre-wrap break-words border',
              m.role === 'user' ? 'bg-[#8A5C38] text-white border-[#7D5333]' : m.error ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-900 border-slate-200')}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-slate-500 font-mono" role="status">
            <ChatbotIcon size={15} variant="brand" className="animate-pulse" />
            <span>{h('chatThinking')}</span>
          </div>
        )}
        <div ref={end} />
      </div>

      <form className="flex items-center gap-2 p-3 border-t border-slate-200 safe-pb" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input className="input !rounded-none !border-slate-300 !h-9 text-xs" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder={h('chatPlaceholder')} aria-label={h('chatPlaceholder')} />
        <button type="submit" className="btn-primary shrink-0 !rounded-none !px-3 !h-9 !bg-[#8A5C38] text-white hover:!bg-[#7D5333]" disabled={busy || !text.trim()} aria-label={h('chatSend')}><Send size={15} /></button>
      </form>
    </div>
  );
}
