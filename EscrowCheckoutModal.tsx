import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { formatETB } from '../lib/format';
import { useI18n } from '../i18n/I18nContext';
import { pct, useAppConfig } from '../lib/config';
import { SMALL_SALE_THRESHOLD_ETB, buyerFeeFor, isSmallSale } from '../lib/money';
import { PLATFORM_META, displayHandle, type EscrowOrder, type Listing } from '../types';

export type CheckoutListing = Pick<Listing, '_id' | 'title' | 'handle' | 'platform' | 'priceETB'>;

interface Props {
  listing: CheckoutListing;
  onClose(): void;
}

/** Only ever send the buyer to Chapa's own payment domain, whatever the server returned. */
function isChapaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'chapa.co' || u.hostname.endsWith('.chapa.co'));
  } catch {
    return false;
  }
}

/**
 * One button: the server creates the escrow order, calls Chapa's initialize endpoint with the exact ETB amount,
 * and answers with the secure checkout_url. The buyer is then redirected to Chapa to pay with Telebirr,
 * CBE Birr, Awash or a card. There is nothing to upload and nothing to confirm by hand: the payment is confirmed
 * by Chapa's webhook and the order moves to "funds held in escrow" on its own.
 */
export default function EscrowCheckoutModal({ listing, onClose }: Props) {
  const { commissionRate, buyerFeeRate, inspectionHours, paymentsMode } = useAppConfig();
  const { t } = useI18n();
  const demo = paymentsMode === 'demo';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const meta = PLATFORM_META[listing.platform];

  useEffect(() => {
    dialogRef.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
  }, [onClose, busy]);

  async function pay() {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ order: EscrowOrder; checkoutUrl: string }>('/escrow', { method: 'POST', body: { listingId: listing._id } });
      if (!isChapaUrl(r.checkoutUrl)) throw new Error('The payment link was not valid. Please try again.');
      window.location.assign(r.checkoutUrl); // the page unloads here, so busy stays on
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const commission = Math.round(listing.priceETB * commissionRate);
  const fee = buyerFeeFor(listing.priceETB, buyerFeeRate);
  const flat = isSmallSale(listing.priceETB, buyerFeeRate);
  const total = listing.priceETB + fee; // the server charges exactly this and checks it again when Chapa confirms

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="escrow-title"
        className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl border-2 border-slate-900 bg-white outline-none sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id="escrow-title" className="text-lg font-extrabold">
              {t('Secure escrow checkout')}
            </h2>
            <p className="truncate text-sm text-slate-600">
              {listing.title} · {meta.label} · {displayHandle(listing.platform, listing.handle)}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label={t('Close')} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg hover:bg-slate-100 disabled:opacity-40">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <dl className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-sm">
            <div className="flex justify-between px-3 py-2.5">
              <dt className="text-slate-600">{t('Listing price')}</dt>
              <dd className="font-extrabold tabular-nums">{formatETB(listing.priceETB)}</dd>
            </div>
            <div className="flex justify-between px-3 py-2.5">
              <dt className="text-slate-600">{flat ? t('Additional buyer service fee (flat, listings under {limit})', { limit: formatETB(SMALL_SALE_THRESHOLD_ETB) }) : t('Additional buyer service fee ({rate})', { rate: pct(buyerFeeRate) })}</dt>
              <dd className="font-bold tabular-nums">{formatETB(fee)}</dd>
            </div>
            <div className="flex justify-between px-3 py-2.5">
              <dt className="font-bold">{t('Total payment')}</dt>
              <dd className="font-extrabold tabular-nums text-blue-700">{formatETB(total)}</dd>
            </div>
          </dl>

          <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            {flat
              ? t('This flat {fee} service fee applies to listings under {limit}. It is added on top of the listing price and is shown before you pay. The amount sent to the payment provider is exactly the total above.', { fee: formatETB(fee), limit: formatETB(SMALL_SALE_THRESHOLD_ETB) })
              : t('This {rate} service fee is added on top of the listing price and is shown before you pay. The amount sent to the payment provider is exactly the total above.', { rate: pct(buyerFeeRate) })}
          </p>

          {demo && (
            <p role="status" className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
              {t('DEMO MODE: no payment provider is connected. Payments are switched off and nothing is charged or paid out.')}
            </p>
          )}

          <div className="rounded-xl bg-blue-50 p-3 text-sm text-slate-700">
            <p className="font-bold text-slate-900">{t('How your money is protected')}</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5">
              <li>{t("You pay on Chapa's secure page with Telebirr, CBE Birr, Awash or a card.")}</li>
              <li>
                {t('When Chapa confirms the payment, {share} ({amount}) of the listing price is locked for the seller and {rate} is the Truth Market commission. The {fee} service fee is kept by Truth Market and does not reduce the seller\'s share. No one has to approve it.', {
                  share: pct(1 - commissionRate),
                  amount: formatETB(listing.priceETB - commission),
                  rate: pct(commissionRate),
                  fee: formatETB(fee),
                })}
              </li>
              <li>{t('The seller hands over the account. You then have {hours} hours to check it.', { hours: inspectionHours })}</li>
              <li>{t('You release the funds, or they release automatically after {hours} hours if there is no problem. Report a problem and the funds stay locked.', { hours: inspectionHours })}</li>
            </ol>
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
          <button onClick={onClose} disabled={busy} className="rounded-xl border-2 border-slate-900 px-5 py-2.5 text-sm font-bold transition hover:bg-slate-900 hover:text-white disabled:opacity-50">
            {t('Cancel')}
          </button>
          <button
            onClick={pay}
            disabled={busy || demo}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t('Opening Chapa...') : demo ? t('Payments are off (demo mode)') : t('Pay {total} with Chapa', { total: formatETB(total) })}
          </button>
        </div>
      </div>
    </div>
  );
}
