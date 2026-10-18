import { Schema, model } from 'mongoose';

/**
 * One row per (order, type). Together they hold every figure the spec asks to keep separately:
 *
 *   listing_price        original listing price (memo, moves no money)
 *   payment_received     buyer payment: price + buyer fee, verified with the payment provider
 *   buyer_fee            the 5% added on top of the price (revenue, held until the sale completes)
 *   platform_commission  the 10% SELLER COMMISSION taken from the seller's proceeds (revenue, held until the sale completes)
 *   seller_escrow        seller net proceeds (price - commission), locked during the inspection window
 *   seller_release       seller net proceeds released to the seller's payable balance
 *   trustmedia_revenue   commission + fee, recognised ONLY when the sale completes
 *   buyer_refund         money returned to the buyer
 *   commission_reversal  the seller commission reversed by a refund
 *   fee_reversal         the buyer fee reversed by a refund
 *
 * (`platform_commission` keeps its original name so rows written before this release stay valid.)
 */
export const LEDGER_TYPES = [
  'listing_price',
  'payment_received',
  'buyer_fee',
  'platform_commission',
  'seller_escrow',
  'seller_release',
  'trustmedia_revenue',
  'buyer_refund',
  'commission_reversal',
  'fee_reversal',
] as const;
export const LEDGER_ACCOUNTS = ['memo', 'platform_clearing', 'platform_revenue', 'seller_escrow', 'seller_payable', 'buyer_refund'] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

/**
 * Append-only escrow ledger. One row per (order, type), enforced by a unique index, so a webhook that
 * arrives twice can never double-count. All amounts are whole ETB.
 */
const ledgerSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'EscrowOrder', required: true },
    listing: { type: Schema.Types.ObjectId, ref: 'Listing' },
    seller: { type: Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: LEDGER_TYPES, required: true },
    account: { type: String, enum: LEDGER_ACCOUNTS, required: true },
    direction: { type: String, enum: ['credit', 'debit'], required: true },
    amountETB: { type: Number, required: true, min: 0 },
    /**
     * posted: final | pending: revenue held while the sale is not complete (can still be reversed) | locked: seller money in escrow |
     * released: seller share released | refunded / reversed: money went back
     */
    status: { type: String, enum: ['posted', 'pending', 'locked', 'released', 'refunded', 'reversed'], default: 'posted' },
    settledAt: Date,
  },
  { timestamps: true },
);

ledgerSchema.index({ order: 1, type: 1 }, { unique: true });
ledgerSchema.index({ account: 1, status: 1 });
ledgerSchema.index({ seller: 1, status: 1 });
ledgerSchema.index({ type: 1, status: 1, settledAt: 1 });
ledgerSchema.index({ type: 1, createdAt: 1 });

export const LedgerEntry = model('LedgerEntry', ledgerSchema);
