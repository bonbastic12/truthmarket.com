import type { Platform } from '../types';

/**
 * Algorithmic ETB price estimator for the sell form.
 *
 *   value = basePer1k[platform] * (audience / 1000) ^ 0.9      (bigger audiences get a slight volume discount)
 *         * engagementFactor                                   (0.5x ... 2x, compared with the platform's typical rate)
 *         * viewDepthFactor                                    (average views vs audience, 0.8x ... 1.3x)
 *         * (monetized ? 1.35 : 1)
 *         * ageFactor                                          (+1% per month of age, up to +40%)
 *
 * The result is shown as a +/-15% range rounded to 50 ETB. The base values are market assumptions
 * for the Ethiopian market and should be tuned with your real sales data.
 */
const BASE_ETB_PER_1K: Record<Platform, number> = {
  telegram: 450,
  tiktok: 300,
  youtube: 900,
  instagram: 350,
  facebook: 200,
  website: 0, // websites are priced from revenue and traffic, see estimateWebsitePrice
};

/** Typical engagement rate (%) per platform: the value that earns a neutral 1.0x engagement factor. */
const TYPICAL_ENGAGEMENT: Record<Platform, number> = {
  telegram: 25,
  tiktok: 8,
  youtube: 4,
  instagram: 3,
  facebook: 1.5,
  website: 1,
};

export interface EstimateInput {
  platform: Platform;
  subscribers: number;
  avgViews: number;
  engagementRate: number;
  ageMonths: number;
  monetized: boolean;
}

export interface Estimate {
  low: number;
  mid: number;
  high: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round50 = (n: number) => Math.max(100, Math.round(n / 50) * 50);

export function estimatePrice(i: EstimateInput): Estimate | null {
  if (!(i.subscribers > 0)) return null;

  const base = BASE_ETB_PER_1K[i.platform] * Math.pow(i.subscribers / 1000, 0.9);
  const engagement = clamp(0.5 + 0.5 * (i.engagementRate / TYPICAL_ENGAGEMENT[i.platform]), 0.5, 2);
  const depth = clamp(0.8 + (i.avgViews / i.subscribers) * 0.5, 0.8, 1.3);
  const monetized = i.monetized ? 1.35 : 1;
  const age = 1 + clamp(i.ageMonths * 0.01, 0, 0.4);

  const mid = base * engagement * depth * monetized * age;
  return { low: round50(mid * 0.85), mid: round50(mid), high: round50(mid * 1.15) };
}

export interface WebsiteEstimateInput {
  monthlyVisits: number;
  monthlyRevenueETB: number;
  domainAgeMonths: number;
  /** true when the handover includes the source code */
  includesSource: boolean;
}

/**
 * Website value, the way small sites are usually priced:
 *
 *   value = monthly revenue x 24 months                        (an earning site sells for about 2 years of revenue)
 *         + monthly visits x 0.15 ETB                          (traffic has value even before it earns: 10,000 visits = 1,500 ETB)
 *         then x domainAgeFactor (+0.5% per month, up to +30%) and x 1.1 when the source code is included.
 *
 * Shown as a +/-20% range (websites vary more than social accounts), rounded to 50 ETB.
 * The multiples are assumptions: tune them with real sales.
 */
export function estimateWebsitePrice(i: WebsiteEstimateInput): Estimate | null {
  if (!(i.monthlyVisits > 0) && !(i.monthlyRevenueETB > 0)) return null;
  const earning = i.monthlyRevenueETB * 24;
  const traffic = i.monthlyVisits * 0.15;
  const age = 1 + clamp(i.domainAgeMonths * 0.005, 0, 0.3);
  const source = i.includesSource ? 1.1 : 1;
  const mid = (earning + traffic) * age * source;
  return { low: round50(mid * 0.8), mid: round50(mid), high: round50(mid * 1.2) };
}
