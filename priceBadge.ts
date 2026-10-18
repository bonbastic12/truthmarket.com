import type { Listing } from '../types';
import { estimatePrice, estimateWebsitePrice, type Estimate } from './priceEstimator';

export type PriceTier = 'veryGood' | 'good' | 'fair';

/** Truth Market's own estimate for a listing, from the same formulas the sell form shows to sellers. */
export function estimateFor(l: Listing): Estimate | null {
  if (l.platform === 'website' && l.website) {
    return estimateWebsitePrice({
      monthlyVisits: l.website.monthlyVisits,
      monthlyRevenueETB: l.website.monthlyRevenueETB,
      domainAgeMonths: l.website.domainAgeMonths,
      includesSource: l.transferMethods.includes('source_code'),
    });
  }
  return estimatePrice({
    platform: l.platform,
    subscribers: l.subscribers,
    avgViews: l.avgViews,
    engagementRate: l.engagementRate,
    ageMonths: l.ageMonths,
    monetized: l.monetized,
  });
}

/**
 * Where the asking price sits against the estimate range (low / mid / high):
 *   at or under the low end  -> Very Good Price
 *   at or under the middle   -> Good Price
 *   at or under the high end -> Fair
 *   above the range          -> no badge (we do not label an expensive listing)
 * Returns null when there is not enough data to estimate.
 */
export function priceTier(l: Listing): PriceTier | null {
  const e = estimateFor(l);
  if (!e || !(l.priceETB > 0)) return null;
  if (l.priceETB <= e.low) return 'veryGood';
  if (l.priceETB <= e.mid) return 'good';
  if (l.priceETB <= e.high) return 'fair';
  return null;
}
