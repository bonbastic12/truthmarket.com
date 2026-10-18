import type { CSSProperties, ReactNode } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { formatAge, formatCompact, formatETB, formatMoney } from '../lib/format';
import { PLATFORM_THEME, isNewListing } from '../lib/platformTheme';
import { PLATFORM_META, SITE_TYPE_LABEL, TRANSFER_META, displayHandle, type Listing } from '../types';
import PlatformIcon from './PlatformIcon';
import { useAppConfig } from '../lib/config';
import { buyerFeeFor } from '../lib/money';
import PriceBadge from './PriceBadge';

interface Props {
  listing: Listing;
  isOwn: boolean;
  onBuy(listing: Listing): void;
}

const ico = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, className: 'h-4 w-4' };
const Users = () => <svg {...ico}><circle cx="9" cy="8" r="3.500" /><path d="M2.500 20a6.500 6.500 0 0113 0M16 4.500a3.500 3.500 0 010 7M18 14.500a6 6 0 013.500 5.500" /></svg>;
const Eye = () => <svg {...ico}><path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
const Heart = () => <svg {...ico}><path d="M12 20s-7.500-4.500-7.500-10A4.500 4.500 0 0112 7a4.500 4.500 0 017.500 3c0 5.500-7.500 10-7.500 10z" /></svg>;
const Coins = () => <svg {...ico}><circle cx="12" cy="12" r="9" /><path d="M9.500 9.500h4a1.500 1.500 0 010 3h-3a1.500 1.500 0 000 3h4M12 7v2M12 15.500v2" /></svg>;
const Clock = () => <svg {...ico}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const Cart = () => <svg {...ico}><path d="M3 4h2.500l2 11h10l2-8H7M9 20h.01M17 20h.01" /></svg>;
const External = () => <svg {...ico} className="h-3 w-3"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></svg>;

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl bg-slate-50 px-2.5 py-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-base font-extrabold leading-tight tabular-nums">{value}</p>
        <p className="truncate text-[11px] font-semibold text-slate-500">{label}</p>
        {hint && <p className="truncate text-[10px] font-medium text-slate-500">{hint} {t('entered')}</p>}
      </div>
    </div>
  );
}

function Avatar({ listing, gradient }: { listing: Listing; gradient: string }) {
  const initials = listing.handle.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
  // Only http(s) pictures are shown, so a stored "javascript:" or "data:" address can never run.
  const src = listing.avatarUrl && /^https?:\/\//i.test(listing.avatarUrl) ? listing.avatarUrl : null;
  return src ? (
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-14 w-14 shrink-0 rounded-2xl border border-slate-200 object-cover" />
  ) : (
    <span aria-hidden="true" style={{ background: gradient }} className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-lg font-extrabold text-white">
      {initials}
    </span>
  );
}

/**
 * Marketplace card: a coloured platform strip on the left, then avatar, NEW tag, handle, "Open on <platform>" link,
 * category and price badge, a metrics grid, and the price with a Buy button in the platform's colours.
 * The metrics shown are the ones we store (audience, average views/reach, engagement); likes are not collected.
 */
export default function ListingCard({ listing, isOwn, onBuy }: Props) {
  const { buyerFeeRate } = useAppConfig();
  const { t } = useI18n();
  const meta = PLATFORM_META[listing.platform];
  const theme = PLATFORM_THEME[listing.platform];
  const site = listing.platform === 'website' ? listing.website : undefined;
  const sellerName = typeof listing.seller === 'string' ? '' : listing.seller.name;
  const label = listing.platform === 'website' ? t('Websites & Apps') : meta.label;
  const href = theme.link(listing.handle, site?.url);
  const isNew = isNewListing(listing.createdAt);
  const canBuy = !isOwn && listing.status === 'active';
  const btnStyle: CSSProperties | undefined = canBuy ? { background: theme.action } : undefined;

  return (
    <article className="flex overflow-hidden rounded-2xl border-[1.5px] border-slate-900 bg-white shadow-[3px_3px_0_0_#0f172a] transition hover:-translate-y-0.5 dark:shadow-[3px_3px_0_0_#2f6bff]">
      {/* Left accent strip: icon on top, platform name reading upwards */}
      <div style={{ background: theme.strip }} className="flex w-9 shrink-0 flex-col items-center gap-3 py-3 text-white sm:w-10">
        <PlatformIcon platform={listing.platform} mono className="h-4 w-4" />
        <span className="text-[11px] font-extrabold uppercase tracking-[0.18em] [rotate:180deg] [writing-mode:vertical-rl]">{label}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3.5 sm:p-4">
        <div className="flex items-start gap-3">
          <Avatar listing={listing} gradient={theme.action} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {isNew && <span className="rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-white">{t('NEW')}</span>}
              <h3 className="min-w-0 truncate text-base font-extrabold leading-tight sm:text-lg" title={listing.title}>
                {displayHandle(listing.platform, listing.handle)}
              </h3>
              {listing.verified && (
                <span title={t('Verified')} className="inline-flex items-center text-emerald-600">
                  <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-label={t('Verified')} role="img">
                    <path d="M10 1.500l2.200 1.700 2.700-.1.900 2.600 2.200 1.600-.9 2.600.9 2.600-2.200 1.600-.9 2.600-2.700-.1L10 18.500l-2.200-1.700-2.700.1-.9-2.600L2 12.700l.9-2.600L2 7.500l2.200-1.600.9-2.600 2.700.1zm-1 11l4.700-4.700-1.100-1.100L9 10.400 7.400 8.800 6.300 9.900z" />
                  </svg>
                </span>
              )}
            </div>
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline">
                {t('Open on {platform}', { platform: label })} <External />
              </a>
            ) : (
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{label}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-semibold">{t(listing.category)}</span>
              {site && <span className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-semibold">{SITE_TYPE_LABEL[site.siteType]}</span>}
              {listing.monetized && !site && <span className="rounded-md border border-emerald-300 px-2 py-0.5 text-xs font-semibold text-emerald-700">{t('Monetized')}</span>}
              <PriceBadge listing={listing} />
            </div>
          </div>
        </div>

        {site ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat icon={<Users />} label={t('Visits / month')} value={formatCompact(site.monthlyVisits)} />
              <Stat
                icon={<Coins />}
                label={t('Revenue / month')}
                value={site.monthlyRevenueETB > 0 ? `${formatCompact(site.monthlyRevenueETB)} ETB` : t('None')}
                hint={site.revenueCurrency === 'USD' && site.monthlyRevenue > 0 ? formatMoney(site.monthlyRevenue, 'USD') : undefined}
              />
              <Stat icon={<Eye />} label={t('Monthly pageviews')} value={formatCompact(site.monthlyPageviews)} />
              <Stat icon={<Clock />} label={t('Domain age')} value={formatAge(site.domainAgeMonths)} />
            </div>
            <ul className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold" aria-label={t('Tech stack')}>
              {site.techStack.slice(0, 5).map((s) => (
                <li key={s} className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-white">{s}</li>
              ))}
              {site.techStack.length > 5 && <li className="px-1 py-0.5 text-slate-500">+{site.techStack.length - 5}</li>}
              {site.hostingProvider && <li className="rounded-md border border-slate-200 px-2 py-0.5">Hosting: {site.hostingProvider}</li>}
            </ul>
          </>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat icon={<Users />} label={t(meta.audienceLabel)} value={formatCompact(listing.subscribers)} />
            <Stat icon={<Eye />} label={t(meta.viewsLabel)} value={formatCompact(listing.avgViews)} />
            <Stat icon={<Heart />} label={t('Engagement')} value={`${listing.engagementRate.toFixed(1)}%`} />
            <Stat icon={<Clock />} label={t('Age')} value={formatAge(listing.ageMonths)} />
          </div>
        )}

        <ul className="mt-3 flex flex-wrap gap-1 text-[11px] text-slate-600" aria-label={t('Transfer methods')}>
          {listing.transferMethods.map((m) => (
            <li key={m} title={TRANSFER_META[m].hint} className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-800">{TRANSFER_META[m].label}</li>
          ))}
        </ul>

        <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-200 pt-3.5">
          <div className="min-w-0">
            <p className="text-2xl font-extrabold leading-none tabular-nums">{formatETB(isOwn ? listing.priceETB : listing.priceETB + buyerFeeFor(listing.priceETB, buyerFeeRate))}</p>
            {!isOwn && <p className="mt-1 text-[11px] font-semibold text-slate-500">{t('incl. service fee')}</p>}
            {sellerName && <p className="mt-1 truncate text-xs text-slate-500">{t('by')} {sellerName}</p>}
          </div>
          <button
            type="button"
            disabled={!canBuy}
            onClick={() => onBuy(listing)}
            style={btnStyle}
            aria-label={canBuy ? `${t('Buy with escrow')}: ${listing.title}` : undefined}
            title={canBuy ? t('Buy with escrow') : undefined}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none disabled:hover:brightness-100"
          >
            {canBuy && <Cart />}
            {isOwn ? t('Your listing') : listing.status === 'active' ? t('Buy') : t('Unavailable')}
          </button>
        </div>
      </div>
    </article>
  );
}
