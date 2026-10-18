import { Schema, model } from 'mongoose';

export const PAYOUT_METHODS = [
  'telebirr', 'cbe_birr', 'cbe', 'awash', 'dashen', 'abyssinia', 'wegagen', 'hibret', 'nib', 'zemen', 'oromia', 'bunna', 'enat', 'berhan',
] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
/** Mobile wallets take a phone number, banks take an account number. */
export const WALLET_METHODS: readonly PayoutMethod[] = ['telebirr', 'cbe_birr'];

export const WITHDRAWAL_STATUSES = ['requested', 'paid', 'rejected'] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

/**
 * A seller's request to take released sales money out. The balance is never stored: it is always
 * (released sales) - (requested + paid withdrawals), so a rejected request frees its amount again with no repair job.
 */
const withdrawalSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amountETB: { type: Number, required: true, min: 1 },
    method: { type: String, enum: PAYOUT_METHODS, required: true },
    accountName: { type: String, required: true, trim: true, maxlength: 80 },
    /** AES-256-GCM encrypted (same key as the ID data, bound to the owner). Only an admin paying it out can read it. */
    accountEnc: { type: String, required: true, select: false },
    accountLast4: { type: String, required: true, maxlength: 4 },
    status: { type: String, enum: WITHDRAWAL_STATUSES, default: 'requested' },
    /** Transaction reference from the bank or Telebirr, entered by the admin who paid. */
    paymentReference: { type: String, maxlength: 80 },
    rejectionReason: { type: String, maxlength: 300 },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
  },
  { timestamps: true },
);

withdrawalSchema.index({ user: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, createdAt: 1 });

export const Withdrawal = model('Withdrawal', withdrawalSchema);
