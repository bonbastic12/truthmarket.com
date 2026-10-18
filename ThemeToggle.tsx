import { useI18n } from '../i18n/I18nContext';
import { useTheme } from './ThemeContext';

/** Sun / moon switch. Shows the mode you will switch TO, and announces the current state to screen readers. */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={t('Dark mode')}
      title={dark ? t('Switch to light mode') : t('Switch to dark mode')}
      onClick={toggle}
      className="relative inline-flex h-9 w-[4.25rem] shrink-0 items-center rounded-full border border-slate-300 bg-slate-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    >
      <svg viewBox="0 0 24 24" className="absolute left-2 h-4 w-4 fill-none stroke-amber-500 stroke-2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.900 16.900l1.800 1.800M5.300 18.700l1.800-1.800M16.900 7.100l1.800-1.800" />
      </svg>
      <svg viewBox="0 0 24 24" className="absolute right-2 h-4 w-4 fill-none stroke-slate-500 stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500z" />
      </svg>
      <span
        aria-hidden="true"
        className={`absolute top-1 grid h-7 w-7 place-items-center rounded-full bg-blue-600 text-white shadow transition-all duration-200 ${dark ? 'left-[2.125rem]' : 'left-1'}`}
      >
        {dark ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white" aria-hidden="true"><path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-white stroke-2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600l1.400 1.400M17 17l1.400 1.400M5.600 18.400L7 17M17 7l1.400-1.400" />
          </svg>
        )}
      </span>
    </button>
  );
}
