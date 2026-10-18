import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useI18n } from '../i18n/I18nContext';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Truth Market AI Assistant. Questions go to our own API (/api/assistant); the AI provider key lives only on the server.
 * The assistant can explain how the marketplace works but cannot see or change orders, balances or accounts.
 */
export default function AssistantWidget() {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs, busy, open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: 'user', content: q }];
    setMsgs(next);
    setText('');
    setError('');
    setBusy(true);
    try {
      const r = await api<{ reply: string }>('/assistant', { method: 'POST', body: { lang, messages: next.slice(-10) } });
      setMsgs([...next, { role: 'assistant', content: r.reply }]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="tm-assistant"
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-40 inline-flex items-center gap-2 rounded-full border-[1.5px] border-slate-900 bg-white px-4 py-2.5 text-sm font-extrabold shadow-[3px_3px_0_0_#0f172a] transition active:scale-95 dark:shadow-[3px_3px_0_0_#2f6bff] md:bottom-5 md:right-5"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 5h16v11H9l-5 4z" /><path d="M8.500 9.500h7M8.500 12.500h4" />
        </svg>
        {t('Ask assistant')}
      </button>

      {open && (
        <section
          id="tm-assistant"
          role="dialog"
          aria-label={t('Truth Market Assistant')}
          className="fixed inset-x-3 bottom-[calc(8.5rem+env(safe-area-inset-bottom))] z-50 flex max-h-[min(32rem,60vh)] flex-col overflow-hidden rounded-2xl border-[1.5px] border-slate-900 bg-white shadow-2xl sm:left-auto sm:w-96 md:bottom-20 md:right-5"
        >
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-extrabold">{t('Truth Market Assistant')}</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label={t('Close')} className="rounded-full p-1 text-slate-500 hover:bg-slate-100">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
            {msgs.length === 0 && <p className="text-slate-600">{t('Ask how buying, selling, escrow or identity verification works. Never share passwords or codes here.')}</p>}
            {msgs.map((m, i) => (
              <p key={i} className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 leading-relaxed ${m.role === 'user' ? 'ml-auto bg-blue-600 text-white' : 'bg-slate-100 text-slate-900'}`}>
                {m.content}
              </p>
            ))}
            {busy && <p className="text-xs text-slate-500">{t('Loading...')}</p>}
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
            <div ref={endRef} />
          </div>

          <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              placeholder={t('Type your question')}
              aria-label={t('Type your question')}
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            />
            <button type="submit" disabled={busy || !text.trim()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-slate-300">
              {t('Send')}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
