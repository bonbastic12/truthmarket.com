import { Schema, model } from 'mongoose';

/** withdrawal_requested: the seller asked | payout_completed: an admin paid it (reference kept) | withdrawal_rejected: the request was refused. */
export const PAYOUT_ENTRY_TYPES = ['withdrawal_requested', 'payout_completed', 'withdrawal_rejected'] as const;

/**
 * Append-only record of money leaving through withdrawals and payouts. It lives beside the order ledger (a withdrawal
 * belongs to no single order). One row per (withdrawal, type) by unique index, so a retried or double-clicked decision
 * can never be recorded twice.
 */
const payoutEntrySchema = new Schema(
  {
    withdrawal: { type: Schema.Types.ObjectId, ref: 'Withdrawal', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: PAYOUT_ENTRY_TYPES, required: true },
    amountETB: { type: Number, required: true, min: 1 },
    reference: { type: String, maxlength: 80 },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

payoutEntrySchema.index({ withdrawal: 1, type: 1 }, { unique: true });
payoutEntrySchema.index({ type: 1, createdAt: 1 });
payoutEntrySchema.index({ user: 1, createdAt: -1 });

export const PayoutEntry = model('PayoutEntry', payoutEntrySchema);
