import { Schema, model } from 'mongoose';

/** The one document that holds the commission rates. `_id` is fixed so there can never be two. */
export const PLATFORM_SETTINGS_ID = 'commission';

/**
 * Commission configuration. Rates are stored as basis points (1000 = 10%, 500 = 5%).
 * Only an administrator can change them (PUT /api/admin/settings/commission), every change is kept in `history`,
 * and each order copies the rates at creation, so changing them never rewrites a past transaction.
 */
const settingsSchema = new Schema(
  {
    _id: { type: String, default: PLATFORM_SETTINGS_ID },
    sellerCommissionBps: { type: Number, required: true, min: 0, max: 5000 },
    buyerFeeBps: { type: Number, required: true, min: 0, max: 5000 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    history: {
      type: [
        new Schema(
          {
            at: { type: Date, default: Date.now },
            by: { type: Schema.Types.ObjectId, ref: 'User' },
            sellerCommissionBps: Number,
            buyerFeeBps: Number,
            previousSellerCommissionBps: Number,
            previousBuyerFeeBps: Number,
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const PlatformSettings = model('PlatformSettings', settingsSchema);
