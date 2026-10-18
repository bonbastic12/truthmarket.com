import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AM } from './am';

export type Lang = 'en' | 'am';
const KEY = 'tm-lang';

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translates an English UI string. Unknown strings stay English. `{name}` placeholders are filled from `vars`. */
  t: (en: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nValue | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'am' || saved === 'en') return saved;
  } catch {
    /* private mode */
  }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang === 'am' ? 'am' : 'en';
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* the choice then lasts for this visit only */
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const t = useCallback(
    (en: string, vars?: Record<string, string | number>) => {
      let s = lang === 'am' ? (AM[en] ?? en) : en;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
      return s;
    },
    [lang],
  );
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>');
  return v;
}
