import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PLATFORMS, PLATFORM_META } from '../types';
import { useI18n } from '../i18n/I18nContext';
import ThemeToggle from '../theme/ThemeToggle';
import LanguageToggle from './LanguageToggle';
import Logo from './Logo';
import PlatformIcon from './PlatformIcon';

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?';
}

export default function Header() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const onMarket = location.pathname === '/';
  const activePlatform = onMarket ? params.get('platform') : null;

  // Close the profile menu on outside click, Escape, or navigation.
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  useEffect(() => setOpen(false), [location.pathname, location.search]);

  const tab = (active: boolean) =>
    `whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
      active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
    }`;

  return (
    <header className="sticky top-0 z-30 border-b-2 border-slate-900 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
        <Link to="/" className="shrink-0" aria-label="Truth Market home">
          <Logo />
        </Link>

        <nav aria-label="Platforms" className="no-scrollbar hidden gap-1 overflow-x-auto px-2 md:flex md:flex-1">
          <NavLink to="/" end className={() => tab(onMarket && !activePlatform)}>
            {t('All')}
          </NavLink>
          {PLATFORMS.map((p) => (
            <Link key={p} to={`/?platform=${p}`} className={`${tab(activePlatform === p)} ${p === 'website' ? 'inline-flex items-center gap-1.5' : ''}`}>
              {p === 'website' && <PlatformIcon platform={p} className="h-4 w-4" />}
              {p === 'website' ? t('Websites & Apps') : PLATFORM_META[p].label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
          <Link
            to="/sell"
            className="hidden rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700 lg:inline-block"
          >
            {t('Sell a channel')}
          </Link>

          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                className="flex items-center gap-2 rounded-full border border-slate-300 py-1 pl-1 pr-3 transition hover:border-slate-900"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white">{initials(user.name)}</span>
                <span className="hidden max-w-[8rem] truncate text-sm font-semibold sm:block">{user.name.split(' ')[0]}</span>
                <svg viewBox="0 0 20 20" className="h-4 w-4 fill-slate-500" aria-hidden="true">
                  <path d="M5.5 7.5l4.5 5 4.500-5z" />
                </svg>
              </button>

              {open && (
                <div role="menu" className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="truncate text-sm font-bold">{user.name}</p>
                    <p className="truncate text-xs text-slate-500">{user.email}</p>
                    <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${user.role === 'admin' ? 'bg-slate-900 text-white' : 'bg-blue-100 text-blue-800'}`}>
                      {user.role === 'admin' ? t('Admin') : user.verifiedSeller ? t('Verified seller') : t('Member')}
                    </span>
                  </div>
                  {user.role !== 'admin' && !user.isVerified && (
                    <Link role="menuitem" to="/verify" className="block px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-slate-50">
                      {user.kycStatus === 'flagged' ? t('Account on hold') : user.kycStatus === 'pending_review' ? t('ID under review') : t('Verify identity to sell')}
                    </Link>
                  )}
                  <Link role="menuitem" to="/orders" className="block px-4 py-2.5 text-sm font-medium hover:bg-slate-50">
                    {t('My orders')}
                  </Link>
                  <Link role="menuitem" to="/wallet" className="block px-4 py-2.5 text-sm font-medium hover:bg-slate-50">
                    {t('My wallet')}
                  </Link>
                  <Link role="menuitem" to="/sell" className="block px-4 py-2.5 text-sm font-medium hover:bg-slate-50">
                    {t('Sell a channel')}
                  </Link>
                  {user.role === 'admin' && (
                    <Link role="menuitem" to="/admin" className="block px-4 py-2.5 text-sm font-medium hover:bg-slate-50">
                      {t('Admin dashboard')}
                    </Link>
                  )}
                  {user.role === 'admin' && (
                    <Link role="menuitem" to="/admin/revenue" className="block px-4 py-2.5 text-sm font-medium hover:bg-slate-50">
                      {t('Commission & Revenue')}
                    </Link>
                  )}
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      logout();
                      navigate('/');
                    }}
                    className="block w-full border-t border-slate-100 px-4 py-2.5 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
                  >
                    {t('Log out')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link to="/login" className="hidden rounded-full px-3 py-2 text-sm font-semibold hover:bg-slate-100 sm:inline-block">
                {t('Log in')}
              </Link>
              <Link to="/register" className="rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
                {t('Sign up')}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
