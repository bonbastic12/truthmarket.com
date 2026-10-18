import { Types } from 'mongoose';
import { EscrowOrder } from '../models/EscrowOrder';
import { computeBreakdown } from './money';
import { getWallet } from './payoutService';

const PAID_STATUSES = ['FUNDS_HELD_IN_ESCROW', 'TRANSFERRED', 'DISPUTED', 'COMPLETED', 'REFUNDED'];

/**
 * A seller's own sales, and nothing else. The query is scoped to the caller's id on the server, and the answer contains no buyer
 * fee, no buyer total and no platform totals: a seller sees the listing price, the commission taken from THEM and what they receive.
 */
export async function sellerEarnings(userId: string) {
  const [orders, wallet] = await Promise.all([
    EscrowOrder.find({ seller: new Types.ObjectId(userId), status: { $in: PAID_STATUSES } })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('listing', 'title handle domain platform')
      .lean(),
    getWallet(userId),
  ]);

  const sales = orders.map((o) => {
    // The 10% (or whatever it was on that day) comes from the rate copied onto the order, not from today's setting.
    const b = computeBreakdown(o.priceETB, o.commissionRate, 0);
    const l = o.listing as unknown as { title?: string; handle?: string; domain?: string; platform?: string } | null;
    return {
      id: String(o._id),
      date: o.createdAt,
      listing: l?.title ?? l?.handle ?? l?.domain ?? '',
      platform: l?.platform ?? '',
      status: o.status,
      priceETB: b.priceETB,
      commissionRate: o.commissionRate,
      commissionETB: b.sellerCommissionETB,
      netETB: b.sellerNetETB,
      /** in_escrow: inside the buyer's inspection window | available: released | refunded: the sale was reversed, nothing is owed */
      payout: o.status === 'COMPLETED' ? 'released' : o.status === 'REFUNDED' ? 'refunded' : 'in_escrow',
    };
  });
  const live = sales.filter((s) => s.payout !== 'refunded');
  return {
    totals: {
      listingPriceETB: live.reduce((a, s) => a + s.priceETB, 0),
      commissionETB: live.reduce((a, s) => a + s.commissionETB, 0),
      netProceedsETB: live.reduce((a, s) => a + s.netETB, 0),
      /** Net proceeds that are not yet in the seller's hands: still in escrow, released but not withdrawn, or requested and waiting. */
      pendingPayoutETB: wallet.lockedETB + wallet.availableETB + wallet.pendingETB,
      completedPayoutsETB: wallet.paidETB,
    },
    wallet,
    sales,
  };
}
