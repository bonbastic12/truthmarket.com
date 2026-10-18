import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth/AuthContext';
import { formatDate, formatETB } from '../lib/format';
import { orderTotal } from '../lib/money';
import { ORDER_STATUS_META, timeLeft } from '../lib/orderStatus';
import { pct } from '../lib/config';
import { displayHandle, type EscrowOrder } from '../types';

const btn = 'rounded-lg px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50';

export default function OrdersPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<EscrowOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setOrders((await api<{ orders: EscrowOrder[] }>('/escrow')).orders);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Keeps statuses and timers fresh, so a payment confirmed by Chapa appears without a manual reload.
    const poll = setInterval(load, 15000);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  async function act(o: EscrowOrder, action: string) {
    setBusyId(o._id);
    setError('');
    try {
      await api(`/escrow/${o._id}/${action}`, { method: 'POST', body: {} });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">My orders</h1>
      <p className="text-sm text-slate-600">Purchases and sales protected by escrow. Payments are confirmed automatically by Chapa.</p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
      {loading && <p className="mt-8 text-sm text-slate-500">Loading...</p>}
      {!loading && orders.length === 0 && (
        <p className="mt-12 text-center text-slate-500">
          No orders yet.{' '}
          <Link to="/" className="font-bold text-blue-700 hover:underline">
            Browse the marketplace
          </Link>
        </p>
      )}

      <ul className="mt-6 space-y-4">
        {orders.map((o) => {
          const meta = ORDER_STATUS_META[o.status];
          const isBuyer = o.buyer._id === user?.id;
          const isSeller = o.seller._id === user?.id;
          const busy = busyId === o._id;
          const payLeft = o.status === 'PENDING_PAYMENT' ? timeLeft(o.expiresAt, now) : null;
          const inspectLeft = o.status === 'TRANSFERRED' ? timeLeft(o.inspectionEndsAt, now) : null;
          return (
            <li key={o._id} className="rounded-2xl border-[1.5px] border-slate-900 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-extrabold">{o.listing?.title ?? 'Removed listing'}</h2>
                  <p className="text-sm text-blue-700">{o.listing ? displayHandle(o.listing.platform, o.listing.handle) : ''}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${meta.tone}`}>{meta.label}</span>
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">{isBuyer ? 'Account price' : 'Sale price'}</dt>
                  <dd className="font-extrabold tabular-nums">{formatETB(o.priceETB)}</dd>
                </div>
                {isBuyer && (o.buyerFeeETB ?? 0) > 0 && (
                  <>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-600">Service fee ({o.buyerFeeFlat ? t('flat') : pct(o.buyerFeeRate ?? 0)})</dt>
                      <dd className="font-semibold tabular-nums">{formatETB(o.buyerFeeETB ?? 0)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="font-bold">You paid</dt>
                      <dd className="font-extrabold tabular-nums">{formatETB(orderTotal(o))}</dd>
                    </div>
                  </>
                )}
                {o.fundsHeldAt && (
                  <>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-600">Commission ({pct(o.commissionRate)})</dt>
                      <dd className="font-semibold tabular-nums">{formatETB(o.commissionETB)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-600">Seller escrow ({pct(1 - o.commissionRate)})</dt>
                      <dd className="font-semibold tabular-nums">{formatETB(o.sellerEscrowETB)}</dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">{isBuyer ? 'Seller' : 'Buyer'}</dt>
                  <dd className="font-semibold">{isBuyer ? o.seller.name : o.buyer.name}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">Opened</dt>
                  <dd>{formatDate(o.createdAt)}</dd>
                </div>
              </dl>

              <p className="mt-3 text-sm text-slate-600">
                {isSeller && o.status === 'FUNDS_HELD_IN_ESCROW'
                  ? 'The buyer has paid and the money is locked. Hand over the account, then tell us below.'
                  : isSeller && o.status === 'TRANSFERRED'
                    ? 'Waiting for the buyer to inspect the account. Your share is released when they confirm, or automatically when the timer ends.'
                    : isSeller && o.status === 'COMPLETED'
                      ? `Released to you: ${formatETB(o.sellerEscrowETB)}.`
                      : meta.help}
              </p>
              {payLeft && <p className="mt-1 text-sm font-semibold text-amber-800">Reserved for you for {payLeft} more.</p>}
              {inspectLeft && (
                <p className="mt-1 text-sm font-semibold text-blue-800">
                  {isBuyer ? 'Inspection time left' : 'Auto-release in'}: {inspectLeft}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {isBuyer && o.status === 'PENDING_PAYMENT' && o.checkoutUrl && payLeft && (
                  <a href={o.checkoutUrl} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
                    Continue to payment
                  </a>
                )}
                {isBuyer && o.status === 'PENDING_PAYMENT' && (
                  <button disabled={busy} onClick={() => act(o, 'cancel')} className={`${btn} border border-slate-300 hover:bg-slate-100`}>
                    Cancel order
                  </button>
                )}
                {isSeller && o.status === 'FUNDS_HELD_IN_ESCROW' && (
                  <button disabled={busy} onClick={() => act(o, 'markTransferred')} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
                    I handed over the account
                  </button>
                )}
                {isBuyer && o.status === 'TRANSFERRED' && (
                  <>
                    <button disabled={busy} onClick={() => window.confirm('Release the money to the seller? This cannot be undone.') && act(o, 'confirmReceipt')} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                      I received it - release funds
                    </button>
                    <button disabled={busy} onClick={() => act(o, 'dispute')} className={`${btn} border border-red-600 text-red-700 hover:bg-red-50`}>
                      Report a problem
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
