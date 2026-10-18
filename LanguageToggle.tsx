import { useI18n, type Lang } from '../i18n/I18nContext';

const OPTIONS: { value: Lang; short: string; label: string }[] = [
  { value: 'en', short: 'EN', label: 'English' },
  { value: 'am', short: 'አማ', label: 'አማርኛ' },
];

/** Two-option segmented switch, EN | አማ. Remembers the choice on this device and sets <html lang>. */
export default function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t('Language')} className="inline-flex shrink-0 rounded-full border border-slate-300 bg-slate-100 p-0.5">
      {OPTIONS.map((o) => {
        const on = lang === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            lang={o.value}
            onClick={() => setLang(o.value)}
            className={`h-8 min-w-[2.5rem] rounded-full px-2.5 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${on ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {o.short}
          </button>
        );
      })}
    </div>
  );
}
