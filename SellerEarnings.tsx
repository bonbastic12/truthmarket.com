import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { useI18n } from '../i18n/I18nContext';
import { pct } from '../lib/config';
import { formatDate, formatETB } from '../lib/format';
import { ORDER_STATUS_META } from '../lib/orderStatus';
import type { SellerEarnings } from '../types';

const PAYOUT_TONE = { in_escrow: 'bg-blue-100 text-blue-800', released: 'bg-emerald-100 text-emerald-800', refunded: 'bg-slate-200 text-slate-700' } as const;
const PAYOUT_LABEL = { in_escrow: 'In escrow', released: 'Released to you', refunded: 'Refunded to buyer' } as const;

/**
 * A seller's own sales: listing price, the commission taken from them, what they receive, and their payouts.
 * The server answers with the caller's rows only and never includes the buyer's fee or any platform total,
 * so there is nothing here that could reveal Truth Market's revenue.
 */
export default function SellerEarningsSection() {
  const { t } = useI18n();
  const [data, setData] = useState<SellerEarnings | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<SellerEarnings>('/wallet/earnings')
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const tot = data?.totals;
  const cards: [string, number, boolean?][] = [
    [t('Listing price'), tot?.listingPriceETB ?? 0],
    [t('Seller commission'), tot?.commissionETB ?? 0],
    [t('Net proceeds'), tot?.netProceedsETB ?? 0, true],
    [t('Pending payout balance'), tot?.pendingPayoutETB ?? 0],
    [t('Completed payouts'), tot?.completedPayoutsETB ?? 0],
  ];

  return (
    <section className="mt-8" aria-labelledby="earn-title">
      <h2 id="earn-title" className="text-lg font-extrabold">{t('My sales and earnings')}</h2>
      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map(([label, value, main]) => (
          <div key={label} className={`rounded-2xl border-[1.5px] p-4 ${main ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'}`}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 truncate text-xl font-extrabold tabular-nums">{formatETB(value)}</p>
          </div>
        ))}
      </div>

      {data && data.sales.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t('No paid sales yet.')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {data?.sales.map((s) => (
            <li key={s.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold">{s.listing}</p>
                  <p className="text-xs text-slate-500">{formatDate(s.date)} · {t(ORDER_STATUS_META[s.status].label)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${PAYOUT_TONE[s.payout]}`}>{t(PAYOUT_LABEL[s.payout])}</span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-[11px] text-slate-500">{t('Listing price')}</dt><dd className="font-bold tabular-nums">{formatETB(s.priceETB)}</dd></div>
                <div><dt className="text-[11px] text-slate-500">{t('Commission ({rate})', { rate: pct(s.commissionRate) })}</dt><dd className="font-bold tabular-nums">−{formatETB(s.commissionETB)}</dd></div>
                <div><dt className="text-[11px] text-slate-500">{t('You receive')}</dt><dd className="font-extrabold tabular-nums text-blue-700">{formatETB(s.netETB)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
