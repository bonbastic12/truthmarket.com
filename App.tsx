import type { ReactNode } from 'react';
import { SMALL_SALE_FLAT_FEE_ETB, SMALL_SALE_THRESHOLD_ETB } from './lib/money';
import { formatETB } from './lib/format';
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import AuthPage from './auth/AuthPage';
import { useAuth } from './auth/AuthContext';
import AdminDashboard from './components/AdminDashboard';
import AdminRevenuePage from './components/AdminRevenuePage';
import AssistantWidget from './components/AssistantWidget';
import BottomNav from './components/BottomNav';
import WalletPage from './components/WalletPage';
import { useI18n } from './i18n/I18nContext';
import Header from './components/Header';
import CheckoutReturnPage from './components/CheckoutReturnPage';
import KycPage from './components/KycPage';
import Marketplace from './components/Marketplace';
import OrdersPage from './components/OrdersPage';
import PrivacyPolicy from './components/PrivacyPolicy';
import { pct, useAppConfig } from './lib/config';
import SellListingPage from './components/SellListingPage';

function Guard({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="p-10 text-center text-slate-500">Loading...</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Layout() {
  const { commissionRate, buyerFeeRate, paymentsMode } = useAppConfig();
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col">
      {paymentsMode === 'demo' && (
        <p role="status" className="bg-red-100 px-3 py-1.5 text-center text-xs font-bold text-red-900">
          {t('DEMO MODE: no payment provider is connected. Payments are switched off and nothing is charged or paid out.')}
        </p>
      )}
      {paymentsMode === 'test' && (
        <p role="status" className="bg-amber-100 px-3 py-1.5 text-center text-xs font-bold text-amber-900">
          {t('TEST MODE: payments are not real. No money is charged or paid out.')}
        </p>
      )}
      <Header />
      <div className="flex-1">
        <Outlet />
      </div>
      {/* pb on mobile reserves the height of the fixed bottom tab bar (3.5rem + home indicator) */}
      <footer className="border-t border-slate-200 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6 text-center text-xs text-slate-500 md:pb-6">
        {t("Truth Market keeps a {rate} commission on every sale. Platforms may forbid selling accounts, so check each platform's rules before you buy or sell.", { rate: pct(commissionRate) })}{' '}
        {t('Buyers pay a {fee} service fee on top of the price (a flat {flat} for listings under {limit}).', { fee: pct(buyerFeeRate), flat: formatETB(SMALL_SALE_FLAT_FEE_ETB), limit: formatETB(SMALL_SALE_THRESHOLD_ETB) })}{' '}
        <Link to="/privacy" className="font-semibold underline">{t('Privacy Policy')}</Link>
      </footer>
      <AssistantWidget />
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Marketplace />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/verify" element={<Guard><KycPage /></Guard>} />
        <Route path="/sell" element={<Guard><SellListingPage /></Guard>} />
        <Route path="/wallet" element={<Guard><WalletPage /></Guard>} />
        <Route path="/orders" element={<Guard><OrdersPage /></Guard>} />
        <Route path="/checkout/return" element={<Guard><CheckoutReturnPage /></Guard>} />
        <Route path="/admin" element={<Guard admin><AdminDashboard /></Guard>} />
        <Route path="/admin/revenue" element={<Guard admin><AdminRevenuePage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
