import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { EscrowOrder } from '../models/EscrowOrder';
import { LEDGER_ACCOUNTS, LEDGER_TYPES, LedgerEntry } from '../models/LedgerEntry';

export interface OrderMoney {
  _id: Types.ObjectId;
  listing: Types.ObjectId;
  seller: Types.ObjectId;
  priceETB: number;
  /** What the buyer paid: price + buyer fee. 0 on orders created before the buyer fee existed. */
  totalETB?: number;
  buyerFeeETB?: number;
  commissionETB: number;
  sellerEscrowETB: number;
  paidETB?: number;
}

type Row = {
  type: (typeof LEDGER_TYPES)[number];
  account: (typeof LEDGER_ACCOUNTS)[number];
  direction: 'credit' | 'debit';
  amountETB: number;
  status: 'posted' | 'pending' | 'locked';
};

/** The full amount the buyer paid. Orders from before the buyer fee have no total, so it is just the price. */
export const grossOf = (o: { priceETB: number; totalETB?: number }) => (o.totalETB && o.totalETB > 0 ? o.totalETB : o.priceETB);

/** Inserts a row once. Running it again (duplicate webhook, retry, reconciliation) changes nothing. */
async function post(o: OrderMoney, row: Row, session?: ClientSession) {
  await LedgerEntry.updateOne(
    { order: o._id, type: row.type },
    { $setOnInsert: { ...row, order: o._id, listing: o.listing, seller: o.seller } },
    { upsert: true, session },
  );
}

/**
 * The split, run when the payment provider has VERIFIED the payment (never from a button):
 *
 *   listing_price        = price                      (memo)
 *   payment_received     = price + buyer fee          (what the buyer paid)
 *   platform_commission  = seller commission          (pending: revenue is not earned until the sale completes)
 *   buyer_fee            = buyer fee                  (pending, same)
 *   seller_escrow        = price - seller commission  (locked: the seller's net proceeds)
 *
 * seller commission + buyer fee + seller net always equal the payment, to the birr.
 */
export async function recordFundsHeld(o: OrderMoney, session?: ClientSession): Promise<void> {
  const fee = o.buyerFeeETB ?? 0;
  await post(o, { type: 'listing_price', account: 'memo', direction: 'credit', amountETB: o.priceETB, status: 'posted' }, session);
  await post(o, { type: 'payment_received', account: 'platform_clearing', direction: 'credit', amountETB: grossOf(o), status: 'posted' }, session);
  await post(o, { type: 'platform_commission', account: 'platform_revenue', direction: 'credit', amountETB: o.commissionETB, status: 'pending' }, session);
  await post(o, { type: 'seller_escrow', account: 'seller_escrow', direction: 'credit', amountETB: o.sellerEscrowETB, status: 'locked' }, session);
  if (fee > 0) await post(o, { type: 'buyer_fee', account: 'platform_revenue', direction: 'credit', amountETB: fee, status: 'pending' }, session);
  await EscrowOrder.updateOne({ _id: o._id }, { $set: { ledgerPosted: true, ledgerVersion: 2 } }, { session });
}

/**
 * The sale is complete (buyer confirmed, admin resolved, or the inspection window ended):
 *  - the seller's net proceeds become payable,
 *  - the seller commission and buyer fee are now EARNED, and the combined Truth Market revenue row is written.
 */
export async function releaseSellerShare(o: OrderMoney, session?: ClientSession): Promise<void> {
  const now = new Date();
  await LedgerEntry.updateOne({ order: o._id, type: 'seller_escrow', status: 'locked' }, { $set: { status: 'released', settledAt: now } }, { session });
  await post(o, { type: 'seller_release', account: 'seller_payable', direction: 'credit', amountETB: o.sellerEscrowETB, status: 'posted' }, session);
  // Only rows still pending flip, so a replay keeps the original settledAt.
  await LedgerEntry.updateOne({ order: o._id, type: 'platform_commission', status: 'pending' }, { $set: { status: 'posted', settledAt: now } }, { session });
  await LedgerEntry.updateOne({ order: o._id, type: 'buyer_fee', status: 'pending' }, { $set: { status: 'posted', settledAt: now } }, { session });
  await post(o, { type: 'trustmedia_revenue', account: 'platform_revenue', direction: 'credit', amountETB: o.commissionETB + (o.buyerFeeETB ?? 0), status: 'posted' }, session);
  await LedgerEntry.updateOne({ order: o._id, type: 'trustmedia_revenue', settledAt: { $exists: false } }, { $set: { settledAt: now } }, { session });
  await EscrowOrder.updateOne({ _id: o._id }, { $set: { ledgerVersion: 2 } }, { session });
}

/**
 * The buyer is refunded before the sale completes. The buyer gets back everything they paid (price + fee),
 * the seller's locked share is returned, and both commission rows are reversed with explicit reversal entries.
 * Revenue was never earned, so none is counted.
 *
 * An order that was flagged for a wrong amount never got a normal ledger; the amount that really arrived is recorded
 * and returned, with no commission at all.
 */
export async function recordRefund(o: OrderMoney & { ledgerPosted?: boolean }, session?: ClientSession): Promise<void> {
  const now = new Date();
  if (!o.ledgerPosted) {
    const paid = o.paidETB ?? 0;
    if (paid > 0) {
      await post(o, { type: 'payment_received', account: 'platform_clearing', direction: 'credit', amountETB: paid, status: 'posted' }, session);
      await post(o, { type: 'buyer_refund', account: 'buyer_refund', direction: 'debit', amountETB: paid, status: 'posted' }, session);
    }
    return;
  }
  await LedgerEntry.updateOne({ order: o._id, type: 'seller_escrow', status: 'locked' }, { $set: { status: 'refunded', settledAt: now } }, { session });
  await LedgerEntry.updateOne({ order: o._id, type: 'platform_commission', status: 'pending' }, { $set: { status: 'reversed', settledAt: now } }, { session });
  await LedgerEntry.updateOne({ order: o._id, type: 'buyer_fee', status: 'pending' }, { $set: { status: 'reversed', settledAt: now } }, { session });
  await post(o, { type: 'commission_reversal', account: 'platform_revenue', direction: 'debit', amountETB: o.commissionETB, status: 'posted' }, session);
  if ((o.buyerFeeETB ?? 0) > 0) await post(o, { type: 'fee_reversal', account: 'platform_revenue', direction: 'debit', amountETB: o.buyerFeeETB ?? 0, status: 'posted' }, session);
  await post(o, { type: 'buyer_refund', account: 'buyer_refund', direction: 'debit', amountETB: grossOf(o), status: 'posted' }, session);
  await EscrowOrder.updateOne({ _id: o._id }, { $set: { ledgerVersion: 2 } }, { session });
}
