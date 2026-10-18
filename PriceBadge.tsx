import { useI18n } from '../i18n/I18nContext';
import { priceTier, type PriceTier } from '../lib/priceBadge';
import type { Listing } from '../types';

const STYLE: Record<PriceTier, { label: string; cls: string; dots: number }> = {
  veryGood: { label: 'Very Good Price', cls: 'border-emerald-600 bg-emerald-50 text-emerald-700', dots: 3 },
  good: { label: 'Good Price', cls: 'border-blue-600 bg-blue-50 text-blue-700', dots: 2 },
  fair: { label: 'Fair', cls: 'border-amber-600 bg-amber-100 text-amber-900', dots: 1 },
};

/** Outlined pill with three dots that repeat the tier, so it never depends on colour alone. */
export default function PriceBadge({ listing }: { listing: Listing }) {
  const { t } = useI18n();
  const tier = priceTier(listing);
  if (!tier) return null;
  const s = STYLE[tier];
  return (
    <span
      title={t("Compared with Truth Market's own estimate for this audience, engagement and age. It is a guide, not a valuation.")}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-extrabold leading-none ${s.cls}`}
    >
      <span aria-hidden="true" className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1.5 w-1.5 rounded-full bg-current ${i < s.dots ? '' : 'opacity-25'}`} />
        ))}
      </span>
      {t(s.label)}
    </span>
  );
}
