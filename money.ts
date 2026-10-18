/**
 * Every commission number in the system comes from this one pure function (no database, no clock),
 * so the server, the ledger, the reports and the tests can never disagree about the arithmetic.
 *
 * All amounts are whole ETB. Rates are handled as basis points (10% = 1000 bps, 5% = 500 bps) so floating point
 * noise such as 0.1 * 3 never leaks into money.
 *
 *   sellerCommission = round(price * sellerRate)   taken OUT of the seller's proceeds
 *   sellerNet        = price - sellerCommission    what the seller receives (never reduced by the buyer fee)
 *   buyerFee         = round(price * buyerRate)    ADDED on top of the price, paid by the buyer
 *                      EXCEPT small sales: a listing priced under SMALL_SALE_THRESHOLD_ETB (1,000) carries a flat
 *                      SMALL_SALE_FLAT_FEE_ETB (100) buyer fee instead (150 -> pays 250). From 1,000 up it is the %.
 *   buyerTotal       = price + buyerFee            exactly what the payment provider is asked to charge
 *   revenue          = sellerCommission + buyerFee Truth Market's income on a completed, verified sale
 *
 * Invariant: buyerTotal === sellerNet + revenue, so not one birr is created or lost.
 */
export interface Breakdown {
  priceETB: number;
  sellerCommissionETB: number;
  sellerNetETB: number;
  buyerFeeETB: number;
  /** true when the flat small-sale fee was applied instead of the percentage */
  buyerFeeFlat: boolean;
  buyerTotalETB: number;
  revenueETB: number;
}

/** Listings priced below this (ETB) pay the flat buyer fee instead of the percentage. */
export const SMALL_SALE_THRESHOLD_ETB = 1_000;
export const SMALL_SALE_FLAT_FEE_ETB = 100;
/** True when this price uses the flat buyer fee. A buyer rate of 0 (fee switched off) stays 0. */
export const isSmallSale = (priceETB: number, buyerFeeRate: number) => buyerFeeRate > 0 && priceETB < SMALL_SALE_THRESHOLD_ETB;

export const toBps = (rate: number): number => Math.round(rate * 10_000);
export const fromBps = (bps: number): number => bps / 10_000;
const part = (priceETB: number, rate: number) => Math.round((priceETB * toBps(rate)) / 10_000);

export function computeBreakdown(priceETB: number, sellerCommissionRate: number, buyerFeeRate: number): Breakdown {
  if (!Number.isInteger(priceETB) || priceETB < 1) throw new RangeError('The price must be a whole number of birr, at least 1');
  for (const r of [sellerCommissionRate, buyerFeeRate]) {
    if (!(r >= 0 && r <= 0.5)) throw new RangeError('A rate must be between 0 and 0.5 (0.10 = 10%)');
  }
  const sellerCommissionETB = part(priceETB, sellerCommissionRate);
  const buyerFeeFlat = isSmallSale(priceETB, buyerFeeRate);
  const buyerFeeETB = buyerFeeFlat ? SMALL_SALE_FLAT_FEE_ETB : part(priceETB, buyerFeeRate);
  return {
    priceETB,
    sellerCommissionETB,
    sellerNetETB: priceETB - sellerCommissionETB,
    buyerFeeETB,
    buyerFeeFlat,
    buyerTotalETB: priceETB + buyerFeeETB,
    revenueETB: sellerCommissionETB + buyerFeeETB,
  };
}
