import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, apiDownload, errorMessage, qs } from '../api';
import { useI18n } from '../i18n/I18nContext';
import { pct } from '../lib/config';
import { formatDate, formatETB } from '../lib/format';
import { ORDER_STATUS_META } from '../lib/orderStatus';
import type { CommissionSettings, OrderStatus, RevenueReportRow, RevenueSummary, RevenueTransaction, SellerPayableRow } from '../types';

type Period = 'daily' | 'weekly' | 'monthly';
const PERIODS: Period[] = ['daily', 'weekly', 'monthly'];
const STATUSES = Object.keys(ORDER_STATUS_META) as OrderStatus[];
const LIMIT = 25;

const field = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20';
const th = 'whitespace-nowrap px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500';
const td = 'whitespace-nowrap px-3 py-2 tabular-nums';

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'main' | 'warn' }) {
  const style = tone === 'main' ? 'border-blue-600 bg-blue-50' : tone === 'warn' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 bg-white';
  return (
    <div className={`rounded-2xl border-[1.5px] p-4 ${style}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 truncate text-xl font-extrabold tabular-nums sm:text-2xl">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/**
 * "Truth Market Commission & Revenue": the private administrator report. This page is only a viewer. Every figure comes from
 * /api/admin/*, which the server protects with requireAuth + requireAdmin, so a buyer or seller who opens this address (or calls
 * the API directly) gets nothing, whatever the browser shows. The route guard in App.tsx only saves them from a blank page.
 */
export default function AdminRevenuePage() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [summaryError, setSummaryError] = useState('');

  const [period, setPeriod] = useState<Period>('daily');
  const [report, setReport] = useState<RevenueReportRow[]>([]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [tx, setTx] = useState<{ items: RevenueTransaction[]; total: number } | null>(null);
  const [txError, setTxError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [payables, setPayables] = useState<SellerPayableRow[]>([]);
  const [settings, setSettings] = useState<CommissionSettings | null>(null);
  const [sellerPct, setSellerPct] = useState('');
  const [buyerPct, setBuyerPct] = useState('');
  const [settingsMsg, setSettingsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api<RevenueSummary>('/admin/revenue/summary'));
      setSummaryError('');
    } catch (e) {
      setSummaryError(errorMessage(e));
    }
  }, []);

  const filters = { q: q.trim(), status, from, to };

  const loadTx = useCallback(
    async (p: number) => {
      try {
        setTx(await api(`/admin/revenue/transactions${qs({ ...filters, page: p, limit: LIMIT })}`));
        setTxError('');
      } catch (e) {
        setTxError(errorMessage(e));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, status, from, to],
  );

  useEffect(() => {
    void loadSummary();
    void (async () => {
      try {
        setPayables((await api<{ items: SellerPayableRow[] }>('/admin/revenue/payables')).items);
        const s = await api<CommissionSettings>('/admin/settings/commission');
        setSettings(s);
        setSellerPct(String(Math.round(s.sellerCommissionRate * 1000) / 10));
        setBuyerPct(String(Math.round(s.buyerFeeRate * 1000) / 10));
      } catch {
        /* the summary error above already explains a refusal */
      }
    })();
  }, [loadSummary]);

  useEffect(() => {
    void (async () => {
      try {
        setReport((await api<{ rows: RevenueReportRow[] }>(`/admin/revenue/reports${qs({ period })}`)).rows);
      } catch {
        setReport([]);
      }
    })();
  }, [period]);

  useEffect(() => {
    const id = setTimeout(() => void loadTx(page), 250); // wait for the person to stop typing
    return () => clearTimeout(id);
  }, [loadTx, page]);

  function search(e: FormEvent) {
    e.preventDefault();
    if (page === 1) void loadTx(1);
    else setPage(1);
  }

  async function exportCsv() {
    setExporting(true);
    setTxError('');
    try {
      await apiDownload(`/admin/revenue/export.csv${qs(filters)}`, 'truthmarket-transactions.csv');
    } catch (e) {
      setTxError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSettingsMsg(null);
    try {
      const s = await api<CommissionSettings>('/admin/settings/commission', {
        method: 'PUT',
        body: { sellerCommissionPct: Number(sellerPct), buyerFeePct: Number(buyerPct) },
      });
      setSettings(s);
      setSettingsMsg({ ok: true, text: t('Saved. New orders use these rates. Existing orders keep the rates they were created with.') });
    } catch (err) {
      setSettingsMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  const pages = tx ? Math.max(1, Math.ceil(tx.total / LIMIT)) : 1;
  const s = summary;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t('Truth Market Commission & Revenue')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('Private administrator report. Buyers and sellers cannot open it.')}</p>
        </div>
        <Link to="/admin" className="rounded-xl border-2 border-slate-900 px-4 py-2 text-sm font-bold transition hover:bg-slate-900 hover:text-white">
          {t('Admin dashboard')}
        </Link>
      </div>

      {summaryError && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {summaryError}{' '}
          <button className="font-bold underline" onClick={() => void loadSummary()}>{t('Try again')}</button>
        </p>
      )}

      {s && !s.reconciled && (
        <p role="alert" className="mt-4 rounded-xl border border-amber-400 bg-amber-100 px-4 py-3 text-sm font-bold text-amber-900">
          {t('The combined revenue does not equal commissions plus fees. Some orders may still be waiting for the background repair job. Check again in a minute.')}
        </p>
      )}

      {/* ---- totals */}
      <section className="mt-5" aria-labelledby="rev-totals">
        <h2 id="rev-totals" className="sr-only">{t('Totals')}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card label={t('Total gross transaction volume')} value={formatETB(s?.grossVolumeETB ?? 0)} sub={t('Every verified buyer payment (price + fee)')} />
          <Card label={t('Seller commissions collected')} value={formatETB(s?.sellerCommissionsETB ?? 0)} sub={t('Completed sales only')} />
          <Card label={t('Buyer fees collected')} value={formatETB(s?.buyerFeesETB ?? 0)} sub={t('Completed sales only')} />
          <Card tone="main" label={t('Combined Truth Market commission revenue')} value={formatETB(s?.combinedRevenueETB ?? 0)} sub={t('{n} completed sales', { n: s?.completedSales ?? 0 })} />
          <Card tone="warn" label={t('Revenue held in escrow')} value={formatETB(s?.heldRevenueETB ?? 0)} sub={t('Not earned until the sale completes')} />
          <Card label={t('Pending payments')} value={formatETB(s?.pendingPayments.total ?? 0)} sub={t('{n} orders waiting for the buyer', { n: s?.pendingPayments.count ?? 0 })} />
          <Card label={t('Completed and verified payments')} value={formatETB(s?.completedVerifiedPayments.total ?? 0)} sub={t('{n} orders', { n: s?.completedVerifiedPayments.count ?? 0 })} />
          <Card label={t('Verified, in escrow')} value={formatETB(s?.verifiedInEscrow.total ?? 0)} sub={t('{n} orders', { n: s?.verifiedInEscrow.count ?? 0 })} />
          <Card label={t('Refunds')} value={formatETB(s?.refunds.total ?? 0)} sub={t('{n} refunds', { n: s?.refunds.count ?? 0 })} />
          <Card label={t('Reversed commissions and fees')} value={formatETB((s?.reversedCommissionsETB ?? 0) + (s?.reversedBuyerFeesETB ?? 0))} sub={`${t('Commission')} ${formatETB(s?.reversedCommissionsETB ?? 0)} · ${t('Fee')} ${formatETB(s?.reversedBuyerFeesETB ?? 0)}`} />
          <Card label={t('Seller payable balances')} value={formatETB(s?.sellerPayables.availableETB ?? 0)} sub={`${t('Locked in escrow')} ${formatETB(s?.sellerPayables.lockedInEscrowETB ?? 0)}`} />
          <Card label={t('Withdrawal requests')} value={formatETB(s?.sellerPayables.withdrawalsRequested.total ?? 0)} sub={t('{n} waiting for payment', { n: s?.sellerPayables.withdrawalsRequested.count ?? 0 })} />
          <Card label={t('Completed payouts')} value={formatETB(s?.sellerPayables.paidOut.total ?? 0)} sub={t('{n} payouts', { n: s?.sellerPayables.paidOut.count ?? 0 })} />
          <Card tone={s && s.needsRefund.count > 0 ? 'warn' : undefined} label={t('Payments needing a refund')} value={formatETB(s?.needsRefund.total ?? 0)} sub={t('{n} orders', { n: s?.needsRefund.count ?? 0 })} />
        </div>
      </section>

      {/* ---- rates */}
      <section className="mt-8" aria-labelledby="rev-rates">
        <h2 id="rev-rates" className="text-lg font-extrabold">{t('Commission settings')}</h2>
        <form onSubmit={saveSettings} className="mt-3 rounded-2xl border-[1.5px] border-slate-900 bg-white p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-bold">
              {t('Seller commission (%)')}
              <input type="number" min={0} max={50} step={0.1} required value={sellerPct} onChange={(e) => setSellerPct(e.target.value)} className={`${field} mt-1.5`} />
            </label>
            <label className="text-sm font-bold">
              {t('Buyer fee (%)')}
              <input type="number" min={0} max={50} step={0.1} required value={buyerPct} onChange={(e) => setBuyerPct(e.target.value)} className={`${field} mt-1.5`} />
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {t('Both rates are copied onto every order when it is created, so changing them never alters a sale that already exists.')}
            {settings && ` ${t('Current: seller {a}, buyer {b}.', { a: pct(settings.sellerCommissionRate), b: pct(settings.buyerFeeRate) })}`}
          </p>
          {settingsMsg && (
            <p role={settingsMsg.ok ? 'status' : 'alert'} className={`mt-3 rounded-xl border px-3 py-2 text-sm font-medium ${settingsMsg.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {settingsMsg.text}
            </p>
          )}
          <button type="submit" disabled={saving} className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? t('Loading...') : t('Save rates')}
          </button>
          {settings && settings.history.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-slate-500">
              {settings.history.slice(0, 5).map((h) => (
                <li key={h.at}>
                  {formatDate(h.at)}: {t('seller')} {pct(h.previousSellerCommissionRate)} → {pct(h.sellerCommissionRate)}, {t('buyer')} {pct(h.previousBuyerFeeRate)} → {pct(h.buyerFeeRate)}
                </li>
              ))}
            </ul>
          )}
        </form>
      </section>

      {/* ---- daily / weekly / monthly */}
      <section className="mt-8" aria-labelledby="rev-reports">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="rev-reports" className="text-lg font-extrabold">{t('Revenue reports')}</h2>
          <div role="tablist" aria-label={t('Report period')} className="inline-flex rounded-xl border-2 border-slate-900 p-0.5">
            {PERIODS.map((p) => (
              <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${period === p ? 'bg-slate-900 text-white' : ''}`}>
                {t(p)}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className={th}>{t('Period')}</th>
                <th className={th}>{t('Sales')}</th>
                <th className={th}>{t('Seller commissions')}</th>
                <th className={th}>{t('Buyer fees')}</th>
                <th className={th}>{t('Revenue')}</th>
                <th className={th}>{t('Refunded')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">{t('No completed sales in this period yet.')}</td></tr>
              ) : (
                report.map((r) => (
                  <tr key={r.period}>
                    <td className={`${td} font-bold`}>{r.period}</td>
                    <td className={td}>{r.sales}</td>
                    <td className={td}>{formatETB(r.sellerCommissionsETB)}</td>
                    <td className={td}>{formatETB(r.buyerFeesETB)}</td>
                    <td className={`${td} font-extrabold`}>{formatETB(r.revenueETB)}</td>
                    <td className={td}>{formatETB(r.refundedETB)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">{t('Revenue is counted on the day the sale completed (Ethiopian time). Refunds are counted on the day they were recorded.')}</p>
      </section>

      {/* ---- transactions */}
      <section className="mt-8" aria-labelledby="rev-tx">
        <h2 id="rev-tx" className="text-lg font-extrabold">{t('Transaction history')}</h2>
        <form onSubmit={search} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <input type="search" value={q} maxLength={80} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t('Search reference, listing, buyer or seller')} aria-label={t('Search transactions')} className={field} />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={t('Status')} className={field}>
            <option value="">{t('All statuses')}</option>
            {STATUSES.map((st) => <option key={st} value={st}>{t(ORDER_STATUS_META[st].label)}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label={t('From')} className={field} />
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label={t('To')} className={field} />
          <button type="button" onClick={() => void exportCsv()} disabled={exporting} className="rounded-xl border-2 border-slate-900 px-4 py-2 text-sm font-bold transition hover:bg-slate-900 hover:text-white disabled:opacity-50">
            {exporting ? t('Loading...') : t('Export CSV')}
          </button>
        </form>

        {txError && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{txError}</p>}

        <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className={th}>{t('Date')}</th>
                <th className={th}>{t('Reference')}</th>
                <th className={th}>{t('Listing')}</th>
                <th className={th}>{t('Buyer')}</th>
                <th className={th}>{t('Seller')}</th>
                <th className={th}>{t('Status')}</th>
                <th className={th}>{t('Listing price')}</th>
                <th className={th}>{t('Buyer fee')}</th>
                <th className={th}>{t('Buyer total')}</th>
                <th className={th}>{t('Seller commission')}</th>
                <th className={th}>{t('Seller net')}</th>
                <th className={th}>{t('Revenue earned')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!tx || tx.items.length === 0 ? (
                <tr><td colSpan={12} className="px-3 py-6 text-center text-slate-500">{tx ? t('No transactions match.') : t('Loading...')}</td></tr>
              ) : (
                tx.items.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{formatDate(r.date)}</td>
                    <td className={`${td} font-mono text-xs`}>{r.txRef}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2">{r.listing}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.buyer}</td>
                    <td className="whitespace-nowrap px-3 py-2">{r.seller}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ORDER_STATUS_META[r.status].tone}`}>{t(ORDER_STATUS_META[r.status].label)}</span>
                    </td>
                    <td className={td}>{formatETB(r.priceETB)}</td>
                    <td className={td}>{formatETB(r.buyerFeeETB)} <span className="text-xs text-slate-500">({r.buyerFeeFlat ? t('flat') : pct(r.buyerFeeRate)})</span></td>
                    <td className={`${td} font-bold`}>{formatETB(r.buyerTotalETB)}</td>
                    <td className={td}>{formatETB(r.sellerCommissionETB)} <span className="text-xs text-slate-500">({pct(r.sellerCommissionRate)})</span></td>
                    <td className={td}>{formatETB(r.sellerNetETB)}</td>
                    <td className={`${td} font-extrabold`}>{formatETB(r.revenueETB)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-slate-500">{tx ? t('{n} transactions', { n: tx.total }) : ''}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 font-bold disabled:opacity-40">{t('Previous')}</button>
            <span className="tabular-nums">{page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 font-bold disabled:opacity-40">{t('Next')}</button>
          </div>
        </div>
      </section>

      {/* ---- seller balances */}
      <section className="mt-8" aria-labelledby="rev-payables">
        <h2 id="rev-payables" className="text-lg font-extrabold">{t('Seller payable balances')}</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className={th}>{t('Seller')}</th>
                <th className={th}>{t('Locked in escrow')}</th>
                <th className={th}>{t('Released')}</th>
                <th className={th}>{t('Withdrawal requested')}</th>
                <th className={th}>{t('Paid out')}</th>
                <th className={th}>{t('Available')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payables.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">{t('No seller balances yet.')}</td></tr>
              ) : (
                payables.map((r) => (
                  <tr key={r.sellerId}>
                    <td className="whitespace-nowrap px-3 py-2 font-bold">{r.name} <span className="font-normal text-slate-500">{r.phone}</span></td>
                    <td className={td}>{formatETB(r.lockedETB)}</td>
                    <td className={td}>{formatETB(r.releasedETB)}</td>
                    <td className={td}>{formatETB(r.requestedETB)}</td>
                    <td className={td}>{formatETB(r.paidETB)}</td>
                    <td className={`${td} font-extrabold`}>{formatETB(r.availableETB)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">{t('Withdrawals are paid by a person outside this site, then marked paid with the bank or Telebirr reference in the admin dashboard.')}</p>
      </section>
    </main>
  );
}
