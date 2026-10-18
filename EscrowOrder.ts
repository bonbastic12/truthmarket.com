import { HydratedDocument, InferSchemaType, Schema, model } from 'mongoose';

export const ORDER_STATUSES = [
  'PENDING_PAYMENT', // order created, buyer is paying on Chapa
  'FUNDS_HELD_IN_ESCROW', // Chapa confirmed the payment (set only by the webhook / server verification)
  'TRANSFERRED', // seller reported the handover, the buyer's inspection window is running
  'COMPLETED', // buyer confirmed or the window ended: seller share released
  'DISPUTED', // buyer reported a problem, funds stay locked
  'CANCELLED', // never paid
  'REFUND_REQUIRED', // money arrived but the order cannot be fulfilled (late payment, wrong amount)
  'REFUNDED', // admin refunded the buyer
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Orders in these states keep their listing locked in "escrow". */
export const OPEN_ORDER_STATUSES = ['PENDING_PAYMENT', 'FUNDS_HELD_IN_ESCROW', 'TRANSFERRED', 'DISPUTED'] as const;

const timelineSchema = new Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    /** webhook | return | sweeper | user | admin */
    source: { type: String, maxlength: 20 },
    note: { type: String, maxlength: 200 },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    listing: { type: Schema.Types.ObjectId, ref: 'Listing', required: true },
    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    priceETB: { type: Number, required: true, min: 1 },
    /** Buyer service fee, fixed when the order is created. Old orders have 0. totalETB = priceETB + buyerFeeETB is what Chapa charges. */
    buyerFeeRate: { type: Number, default: 0, min: 0, max: 0.5 },
    buyerFeeFlat: { type: Boolean, default: false },
    buyerFeeETB: { type: Number, default: 0, min: 0 },
    totalETB: { type: Number, default: 0, min: 0 },
    /** Snapshot of the SELLER commission rate when the order was created (the buyer fee rate is snapshotted above). Later rate changes never touch it. */
    commissionRate: { type: Number, required: true, min: 0, max: 0.5 },
    /** Filled when the payment is confirmed: platform share and the seller's locked share. They add up to priceETB. */
    commissionETB: { type: Number, default: 0, min: 0 },
    sellerEscrowETB: { type: Number, default: 0, min: 0 },

    status: { type: String, enum: ORDER_STATUSES, default: 'PENDING_PAYMENT' },

    /** Unique reference sent to Chapa as tx_ref. */
    txRef: { type: String, required: true, unique: true },
    checkoutUrl: String,
    paymentMethod: { type: String, maxlength: 40 },
    chapaReference: { type: String, maxlength: 80 },

    expiresAt: { type: Date, required: true },
    fundsHeldAt: Date,
    transferredAt: Date,
    inspectionEndsAt: Date,
    completedAt: Date,
    autoReleased: { type: Boolean, default: false },
    /** True once the ledger rows for the payment exist (a reconciliation job repairs any gap). */
    ledgerPosted: { type: Boolean, default: false },
    /** 2 = ledger written by the current rules (revenue recognised only on completion). Older orders are upgraded once by the sweeper. */
    ledgerVersion: { type: Number, default: 1 },
    /** What the provider says the buyer actually paid. Set when the amount did not match, so a refund can return the real amount. */
    paidETB: { type: Number, default: 0, min: 0 },

    timeline: { type: [timelineSchema], default: [] },
  },
  { timestamps: true },
);

orderSchema.index({ buyer: 1, createdAt: -1 });
orderSchema.index({ seller: 1, createdAt: -1 });
orderSchema.index({ listing: 1, status: 1 });
orderSchema.index({ status: 1, createdAt: -1 });
// Background jobs: expire unpaid orders, auto-release finished inspections.
orderSchema.index({ status: 1, expiresAt: 1 });
orderSchema.index({ status: 1, inspectionEndsAt: 1 });
orderSchema.index({ status: 1, ledgerPosted: 1 });
orderSchema.index({ status: 1, ledgerVersion: 1 });

export type OrderAttrs = InferSchemaType<typeof orderSchema>;
export type OrderDoc = HydratedDocument<OrderAttrs>;
export const EscrowOrder = model('EscrowOrder', orderSchema);
