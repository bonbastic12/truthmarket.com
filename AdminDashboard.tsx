import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage, qs } from '../api';
import { formatCompact, formatDate, formatETB } from '../lib/format';
import { orderTotal } from '../lib/money';
import { ORDER_STATUS_META } from '../lib/orderStatus';
import { pct } from '../lib/config';
import KycReviewPanel from './KycReviewPanel';
import { PLATFORM_META, TRANSFER_META, SITE_TYPE_LABEL, displayHandle, type EscrowOrder, type Listing, type ListingPage, type ListingStatus } from '../types';

type Tab = ListingStatus | 'orders' | 'identity';
const TABS: { id: Tab; label: string }[] = [
  { id: 'pending', label: 'Pending review' },
  { id: 'active', label: 'Active' },
  { id: 'escrow', label: 'In escrow' },
  { id: 'sold', label: 'Sold' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'orders', label: 'Escrow orders' },
  { id: 'identity', label: 'Identity checks' },
];

const btn = 'rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50';

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('pending');
  const [stats, setStats] = useState<Record<string, number>>({});
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<EscrowOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const s = await api<{ stats: Record<string, number> }>('/listings/stats');
      setStats(s.stats);
      if (tab === 'identity') {
        // The identity panel loads its own data.
      } else if (tab === 'orders') {
        setOrders((await api<{ orders: EscrowOrder[] }>('/escrow')).orders);
      } else {
        setListings((await api<ListingPage>(`/listings${qs({ status: tab, limit: 50, sort: 'newest' })}`)).items);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  const setStatus = (l: Listing, status: ListingStatus, extra: Record<string, unknown> = {}) =>
    run(l._id, () => api(`/listings/${l._id}/status`, { method: 'PATCH', body: { status, ...extra } }));

  const remove = (l: Listing) => {
    if (!window.confirm(`Delete "${l.title}" permanently? This cannot be undone.`)) return;
    run(l._id, () => api(`/listings/${l._id}`, { method: 'DELETE' }));
  };

  const orderAction = (o: EscrowOrder, action: string) => run(o._id, () => api(`/escrow/${o._id}/${action}`, { method: 'POST', body: {} }));

  const sellerName = (l: Listing) => (typeof l.seller === 'string' ? l.seller : l.seller.name);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Admin dashboard</h1>
      <p className="text-sm text-slate-600">Review new listings, manage inventory and move escrow orders forward.</p>
      <Link to="/admin/revenue" className="mt-3 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">
        Truth Market Commission &amp; Revenue →
      </Link>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TABS.filter((t) => t.id !== 'orders' && t.id !== 'identity').map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-2xl border p-3 text-left transition ${tab === t.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-slate-50 hover:border-slate-900'}`}
          >
            <span className="block text-2xl font-extrabold tabular-nums">{stats[t.id] ?? 0}</span>
            <span className="text-xs font-semibold">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="no-scrollbar mt-5 flex gap-2 overflow-x-auto border-b border-slate-200 pb-3" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-bold ${tab === t.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
      {loading && <p className="mt-6 text-sm text-slate-500">Loading...</p>}

      {!loading && tab !== 'orders' && tab !== 'identity' && listings.length === 0 && <p className="mt-10 text-center text-slate-500">Nothing here.</p>}
      {!loading && tab === 'orders' && orders.length === 0 && <p className="mt-10 text-center text-slate-500">No escrow orders yet.</p>}

      {tab === 'identity' && <KycReviewPanel />}

      {tab !== 'orders' && tab !== 'identity' && (
        <ul className="mt-4 space-y-3">
          {listings.map((l) => {
            const busy = busyId === l._id;
            const meta = PLATFORM_META[l.platform];
            return (
              <li key={l._id} className="rounded-2xl border border-slate-300 bg-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${meta.badge}`}>{meta.label}</span>
                      <h3 className="truncate text-base font-extrabold">{l.title}</h3>
                      {l.verified && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">Verified</span>}
                    </div>
                    <p className="text-sm text-blue-700">{displayHandle(l.platform, l.handle)} · {sellerName(l)} · {formatDate(l.createdAt)}</p>
                    {l.website ? (
                      <>
                        <p className="mt-1 text-sm text-slate-700">
                          <span className="font-semibold">{formatCompact(l.website.monthlyVisits)}</span> visits/mo ·{' '}
                          <span className="font-semibold">{formatCompact(l.website.monthlyRevenueETB)} ETB</span> revenue/mo ·{' '}
                          {SITE_TYPE_LABEL[l.website.siteType]} · domain {l.website.domainAgeMonths} mo
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          Stack: {l.website.techStack.join(', ')}
                          {l.website.hostingProvider && ` · Hosting: ${l.website.hostingProvider}`}
                          {l.website.domainRegistrar && ` · Registrar: ${l.website.domainRegistrar}`}
                        </p>
                        {l.website.hostingNotes && <p className="mt-1 text-xs text-slate-600">Handover notes: {l.website.hostingNotes}</p>}
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-slate-700">
                        <span className="font-semibold">{formatCompact(l.subscribers)}</span> {meta.audienceLabel.toLowerCase()} ·{' '}
                        <span className="font-semibold">{formatCompact(l.avgViews)}</span> avg views ·{' '}
                        <span className="font-semibold">{l.engagementRate.toFixed(1)}%</span> engagement · <span className="capitalize">{l.category}</span>
                        {l.monetized && ' · monetized'}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-600">Transfer: {l.transferMethods.map((m) => TRANSFER_META[m].label).join(', ')}</p>
                    {l.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{l.description}</p>}
                    {l.status === 'rejected' && l.rejectionReason && <p className="mt-1 text-sm font-medium text-red-700">Reason: {l.rejectionReason}</p>}
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
                    <p className="text-lg font-extrabold tabular-nums">{formatETB(l.priceETB)}</p>
                    <div className="flex flex-wrap gap-2">
                      {l.status === 'pending' && (
                        <>
                          <button disabled={busy} onClick={() => setStatus(l, 'active')} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
                            Approve
                          </button>
                          <button disabled={busy} onClick={() => setStatus(l, 'active', { verified: true })} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                            Approve & verify
                          </button>
                          <button disabled={busy} onClick={() => { setRejecting(l._id); setReason(''); }} className={`${btn} border border-red-600 text-red-700 hover:bg-red-50`}>
                            Reject
                          </button>
                        </>
                      )}
                      {l.status === 'active' && (
                        <>
                          <button disabled={busy} onClick={() => setStatus(l, 'active', { verified: !l.verified })} className={`${btn} border border-slate-900 hover:bg-slate-900 hover:text-white`}>
                            {l.verified ? 'Remove badge' : 'Mark verified'}
                          </button>
                          <button disabled={busy} onClick={() => setStatus(l, 'pending')} className={`${btn} border border-slate-300 hover:bg-slate-100`}>
                            Unpublish
                          </button>
                          <button disabled={busy} onClick={() => setStatus(l, 'sold')} className={`${btn} border border-slate-300 hover:bg-slate-100`}>
                            Mark sold
                          </button>
                        </>
                      )}
                      {l.status === 'rejected' && (
                        <button disabled={busy} onClick={() => setStatus(l, 'pending')} className={`${btn} border border-slate-900 hover:bg-slate-900 hover:text-white`}>
                          Re-open for review
                        </button>
                      )}
                      {l.status === 'escrow' && <span className="text-xs font-semibold text-slate-500">Locked by an open escrow order</span>}
                      {l.status !== 'escrow' && (
                        <button disabled={busy} onClick={() => remove(l)} className={`${btn} text-red-700 hover:bg-red-50`}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {rejecting === l._id && (
                  <form
                    className="mt-3 flex flex-col gap-2 sm:flex-row"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await setStatus(l, 'rejected', { rejectionReason: reason || undefined });
                      setRejecting(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={300}
                      placeholder="Reason shown to the seller (optional)"
                      aria-label="Rejection reason"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                    />
                    <button type="submit" className={`${btn} bg-red-600 py-2 text-white hover:bg-red-700`}>
                      Confirm reject
                    </button>
                    <button type="button" onClick={() => setRejecting(null)} className={`${btn} py-2 hover:bg-slate-100`}>
                      Cancel
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'orders' && (
        <>
          <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-slate-700">
            Payments are confirmed automatically by the Chapa webhook. There is no &quot;mark as paid&quot; button on purpose. You only step in for disputes and refunds.
          </p>
          <ul className="mt-4 space-y-3">
            {orders.map((o) => {
              const busy = busyId === o._id;
              const meta = ORDER_STATUS_META[o.status];
              return (
                <li key={o._id} className="rounded-2xl border border-slate-300 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 text-sm">
                      <p className="font-extrabold">
                        {o.listing?.title ?? 'Deleted listing'} <span className="font-medium text-slate-500">@{o.listing?.handle}</span>
                      </p>
                      <p className="text-slate-600">
                        Buyer {o.buyer?.name} {o.buyer?.phone && `(${o.buyer.phone})`} · Seller {o.seller?.name}
                      </p>
                      <p className="text-slate-600">
                        Paid {formatETB(orderTotal(o))}
                        {o.fundsHeldAt && (
                          <>
                            {' '}
                            = commission {formatETB(o.commissionETB)} ({pct(o.commissionRate)}){(o.buyerFeeETB ?? 0) > 0 && <> + buyer fee {formatETB(o.buyerFeeETB ?? 0)}</>} + seller escrow {formatETB(o.sellerEscrowETB)}
                          </>
                        )}
                      </p>
                      <p className="break-all font-mono text-xs text-slate-500">{o.txRef}</p>
                      {o.inspectionEndsAt && o.status === 'TRANSFERRED' && <p className="text-slate-600">Auto-release: {formatDate(o.inspectionEndsAt)}</p>}
                      <p className="text-xs text-slate-500">
                        Opened {formatDate(o.createdAt)}
                        {o.paymentMethod && ` · ${o.paymentMethod}`}
                        {o.autoReleased && ' · auto-released'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${meta.tone}`}>{meta.label}</span>
                      <div className="flex flex-wrap gap-2">
                        {(o.status === 'TRANSFERRED' || o.status === 'DISPUTED') && (
                          <button
                            disabled={busy}
                            onClick={() => window.confirm('Release the seller share now?') && orderAction(o, 'confirmReceipt')}
                            className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
                          >
                            Release to seller
                          </button>
                        )}
                        {['FUNDS_HELD_IN_ESCROW', 'TRANSFERRED', 'DISPUTED', 'REFUND_REQUIRED'].includes(o.status) && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              window.confirm('Mark this order as refunded and relist the account? Send the actual refund from the Chapa dashboard.') && orderAction(o, 'refund')
                            }
                            className={`${btn} border border-red-600 text-red-700 hover:bg-red-50`}
                          >
                            {o.status === 'REFUND_REQUIRED' ? 'Mark refunded' : 'Refund buyer'}
                          </button>
                        )}
                        {o.status === 'PENDING_PAYMENT' && (
                          <button disabled={busy} onClick={() => orderAction(o, 'cancel')} className={`${btn} border border-slate-300 hover:bg-slate-100`}>
                            Cancel unpaid
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
