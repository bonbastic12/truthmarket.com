import { config } from '../config';
import { PLATFORM_SETTINGS_ID, PlatformSettings } from '../models/PlatformSettings';
import { fromBps, toBps } from './money';

export interface Rates {
  sellerCommissionRate: number;
  buyerFeeRate: number;
}

/**
 * The current rates, read from the database. The first read creates the document with the defaults
 * (10% seller commission, 5% buyer fee; COMMISSION_RATE / BUYER_FEE_RATE only seed that first value).
 * The upsert is atomic, so two servers starting together still end up with exactly one document.
 */
export async function getRates(): Promise<Rates> {
  const doc = await PlatformSettings.findOneAndUpdate(
    { _id: PLATFORM_SETTINGS_ID },
    { $setOnInsert: { sellerCommissionBps: toBps(config.commissionRate), buyerFeeBps: toBps(config.buyerFeeRate) } },
    { upsert: true, new: true },
  ).lean();
  if (!doc) throw new Error('Commission settings could not be loaded');
  return { sellerCommissionRate: fromBps(doc.sellerCommissionBps), buyerFeeRate: fromBps(doc.buyerFeeBps) };
}

/** Admin only (the route enforces it). Keeps who changed what and when. Never touches existing orders. */
export async function updateRates(adminId: string, next: { sellerCommissionBps: number; buyerFeeBps: number }): Promise<Rates> {
  const before = await getRates();
  const doc = await PlatformSettings.findOneAndUpdate(
    { _id: PLATFORM_SETTINGS_ID },
    {
      $set: { sellerCommissionBps: next.sellerCommissionBps, buyerFeeBps: next.buyerFeeBps, updatedBy: adminId },
      $push: {
        history: {
          at: new Date(),
          by: adminId,
          sellerCommissionBps: next.sellerCommissionBps,
          buyerFeeBps: next.buyerFeeBps,
          previousSellerCommissionBps: toBps(before.sellerCommissionRate),
          previousBuyerFeeBps: toBps(before.buyerFeeRate),
        },
      },
    },
    { new: true },
  ).lean();
  if (!doc) throw new Error('Commission settings could not be saved');
  return { sellerCommissionRate: fromBps(doc.sellerCommissionBps), buyerFeeRate: fromBps(doc.buyerFeeBps) };
}

export async function getSettingsWithHistory() {
  await getRates();
  const doc = await PlatformSettings.findById(PLATFORM_SETTINGS_ID).lean();
  return {
    ...(await getRates()),
    history: (doc?.history ?? []).slice(-20).reverse().map((h) => ({
      at: h.at,
      by: h.by ? String(h.by) : null,
      sellerCommissionRate: fromBps(h.sellerCommissionBps ?? 0),
      buyerFeeRate: fromBps(h.buyerFeeBps ?? 0),
      previousSellerCommissionRate: fromBps(h.previousSellerCommissionBps ?? 0),
      previousBuyerFeeRate: fromBps(h.previousBuyerFeeBps ?? 0),
    })),
  };
}
