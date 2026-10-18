import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { orderTotal } from '../lib/money';
import { formatETB } from '../lib/format';
import { ORDER_STATUS_META } from '../lib/orderStatus';
import type { EscrowOrder } from '../types';

const MAX_TRIES = 12; // about 30 seconds, enough for a slow webhook

/**
 * Chapa sends the buyer back here after paying. The page asks the server to verify the payment with Chapa
 * (the same safe code the webhook uses) and keeps checking for a few seconds until the order is paid.
 */
export default function CheckoutReturnPage() {
  const [params] = useSearchParams();
  const txRef = params.get('tx_ref') ?? '';
  const [order, setOrder] = useState<EscrowOrder | null>(null);
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!txRef) return;
    let cancelled = false;
    const check = async (n: number) => {
      try {
        const r = await api<{ order: EscrowOrder }>(`/escrow/verify/${encodeURIComponent(txRef)}`);
        if (cancelled) return;
        setOrder(r.order);
        setTries(n);
        if (r.order.status === 'PENDING_PAYMENT' && n < MAX_TRIES) timer.current = setTimeout(() => check(n + 1), 2500);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    };
    check(1);
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
    };
  }, [txRef]);

  const paid = order && order.status !== 'PENDING_PAYMENT' && order.status !== 'CANCELLED';
  const waiting = order?.status === 'PENDING_PAYMENT' && tries < MAX_TRIES;

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-14 text-center">
      {!txRef && <p className="text-slate-600">This page needs a payment reference. Open your orders to see your purchases.</p>}
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      {txRef && !error && !order && <p className="text-slate-600">Confirming your payment with Chapa...</p>}

      {waiting && (
        <>
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" aria-hidden="true" />
          <h1 className="mt-5 text-xl font-extrabold">Confirming your payment</h1>
          <p className="mt-2 text-sm text-slate-600">Chapa is confirming the payment. This takes a few seconds. Please do not close this page.</p>
        </>
      )}

      {order && paid && (
        <>
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700" aria-hidden="true">
            ✓
          </div>
          <h1 className="mt-4 text-2xl font-extrabold">Payment received</h1>
          <p className="mt-2 text-slate-600">
            {formatETB(orderTotal(order))} is held safely in escrow for <strong>{order.listing?.title}</strong>. The seller will now hand over the account.
          </p>
        </>
      )}

      {order && order.status === 'PENDING_PAYMENT' && !waiting && (
        <>
          <h1 className="text-xl font-extrabold">We have not received your payment yet</h1>
          <p className="mt-2 text-sm text-slate-600">If you already paid, it can take a few more minutes. Your order stays reserved and updates by itself. If you did not finish paying, you can continue from your orders.</p>
        </>
      )}

      {order && !paid && order.status === 'CANCELLED' && (
        <>
          <h1 className="text-xl font-extrabold">This order was cancelled</h1>
          <p className="mt-2 text-sm text-slate-600">{ORDER_STATUS_META.CANCELLED.help} If money left your account, it is matched automatically and refunded if needed.</p>
        </>
      )}

      <div className="mt-8 flex justify-center gap-3">
        <Link to="/orders" className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
          My orders
        </Link>
        <Link to="/" className="rounded-xl border-2 border-slate-900 px-5 py-2.5 text-sm font-bold hover:bg-slate-900 hover:text-white">
          Marketplace
        </Link>
      </div>
    </main>
  );
}
