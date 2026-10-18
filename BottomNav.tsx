import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';

type IconProps = { className?: string };
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

const Store = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="M4 9l1.5-5h13L20 9M4 9v10a1 1 0 001 1h14a1 1 0 001-1V9M4 9h16M9 20v-6h6v6" /></svg>
);
const Plus = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
const Receipt = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" /></svg>
);
const WalletIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="M4 7a2 2 0 012-2h11v4M4 7v10a2 2 0 002 2h13a1 1 0 001-1v-3M4 7h14a2 2 0 012 2v2M20 11h-4a2 2 0 000 4h4z" /></svg>
);
const User = ({ className }: IconProps) => (
  <svg {...base} className={className}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></svg>
);

/**
 * Phone-only tab bar (hidden from the md breakpoint up, where the header does the job).
 * Fixed to the bottom, respects the iPhone home indicator via safe-area padding, and
 * App's Layout reserves matching space so it never covers the footer or the last card.
 */
export default function BottomNav() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { pathname } = useLocation();

  const items = [
    { to: '/', label: t('Market'), Icon: Store, end: true },
    { to: '/sell', label: t('Sell'), Icon: Plus, end: false },
    { to: '/orders', label: t('Orders'), Icon: Receipt, end: false },
    { to: '/wallet', label: t('Wallet'), Icon: WalletIcon, end: false },
    user ? { to: '/verify', label: t('Account'), Icon: User, end: false } : { to: '/login', label: t('Log in'), Icon: User, end: false },
  ];
  // The Account tab lights up for the other account pages too.
  const accountPaths = ['/verify', '/login', '/register'];

  return (
    <nav
      aria-label={t('Main navigation')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {items.map(({ to, label, Icon, end }, i) => {
          const isAccount = i === 4;
          const forced = isAccount ? accountPaths.includes(pathname) : undefined;
          return (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) => {
                  const on = forced ?? isActive;
                  return `relative flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-bold transition-colors active:scale-95 ${on ? 'text-blue-700' : 'text-slate-500'}`;
                }}
              >
                {({ isActive }) => {
                  const on = forced ?? isActive;
                  return (
                    <>
                      <span aria-hidden="true" className={`absolute top-0 h-0.5 w-8 rounded-b-full bg-blue-600 transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`} />
                      <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${on ? 'bg-blue-100' : ''}`}>
                        <Icon className="h-[1.3rem] w-[1.3rem]" />
                      </span>
                      <span className="max-w-full truncate">{label}</span>
                    </>
                  );
                }}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
