import { isValidObjectId, Types } from 'mongoose';
import { EscrowOrder } from '../models/EscrowOrder';
import { LedgerEntry } from '../models/LedgerEntry';
import { Listing } from '../models/Listing';
import { PayoutEntry } from '../models/PayoutEntry';
import { User } from '../models/User';
import { Withdrawal } from '../models/Withdrawal';
import { escapeRegex } from '../utils/csv';

/**
 * Everything here is for Truth Market administrators only. The functions do no permission check themselves:
 * the only way in is routes/adminRoutes.ts, which puts requireAuth + requireAdmin in front of every route.
 */

const HELD_STATUSES = ['FUNDS_HELD_IN_ESCROW', 'TRANSFERRED', 'DISPUTED'];
export const TIME_ZONE = 'Africa/Addis_Ababa';

interface Group {
  total: number;
  count: number;
}
const pick = (rows: { _id: { type?: string; status?: string }; total: number; count: number }[], type: string, status?: string): Group =>
  rows
    .filter((r) => r._id.type === type && (status === undefined || r._id.status === status))
    .reduce<Group>((a, r) => ({ total: a.total + r.total, count: a.count + r.count }), { total: 0, count: 0 });

export async function revenueSummary() {
  const [ledger, orders, withdrawals, payouts] = await Promise.all([
    LedgerEntry.aggregate<{ _id: { type: string; status: string }; total: number; count: number }>([
      { $group: { _id: { type: '$type', status: '$status' }, total: { $sum: '$amountETB' }, count: { $sum: 1 } } },
    ]),
    EscrowOrder.aggregate<{ _id: string; count: number; price: number; fee: number }>([
      { $group: { _id: '$status', count: { $sum: 1 }, price: { $sum: '$priceETB' }, fee: { $sum: '$buyerFeeETB' } } },
    ]),
    Withdrawal.aggregate<{ _id: string; count: number; total: number }>([{ $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amountETB' } } }]),
    PayoutEntry.aggregate<{ _id: string; count: number; total: number }>([{ $group: { _id: '$type', count: { $sum: 1 }, total: { $sum: '$amountETB' } } }]),
  ]);

  const orderGroup = (statuses: string[]): Group =>
    orders.filter((o) => statuses.includes(o._id)).reduce<Group>((a, o) => ({ total: a.total + o.price + o.fee, count: a.count + o.count }), { total: 0, count: 0 });
  const wd = (status: string): Group => {
    const r = withdrawals.find((w) => w._id === status);
    return { total: r?.total ?? 0, count: r?.count ?? 0 };
  };

  const sellerCommissions = pick(ledger, 'platform_commission', 'posted');
  const buyerFees = pick(ledger, 'buyer_fee', 'posted');
  const combined = pick(ledger, 'trustmedia_revenue');
  const released = pick(ledger, 'seller_release').total;
  const requested = wd('requested');
  const paid = wd('paid');

  return {
    generatedAt: new Date(),
    grossVolumeETB: pick(ledger, 'payment_received').total, // every verified buyer payment (price + fee)
    listingVolumeETB: pick(ledger, 'listing_price').total,
    sellerCommissionsETB: sellerCommissions.total, // earned: completed sales only
    buyerFeesETB: buyerFees.total,
    combinedRevenueETB: combined.total,
    completedSales: combined.count,
    /** True when combined revenue equals commissions + fees. Anything else means the ledger needs attention. */
    reconciled: combined.total === sellerCommissions.total + buyerFees.total,
    heldRevenueETB: pick(ledger, 'platform_commission', 'pending').total + pick(ledger, 'buyer_fee', 'pending').total,
    pendingPayments: orderGroup(['PENDING_PAYMENT']),
    verifiedInEscrow: orderGroup(HELD_STATUSES),
    completedVerifiedPayments: orderGroup(['COMPLETED']),
    needsRefund: orderGroup(['REFUND_REQUIRED']),
    refunds: pick(ledger, 'buyer_refund'),
    reversedCommissionsETB: pick(ledger, 'commission_reversal').total,
    reversedBuyerFeesETB: pick(ledger, 'fee_reversal').total,
    sellerPayables: {
      lockedInEscrowETB: pick(ledger, 'seller_escrow', 'locked').total,
      releasedETB: released,
      withdrawalsRequested: requested,
      paidOut: paid,
      availableETB: Math.max(0, released - requested.total - paid.total),
    },
    payoutRecords: {
      requested: payouts.find((p) => p._id === 'withdrawal_requested')?.count ?? 0,
      completed: payouts.find((p) => p._id === 'payout_completed')?.count ?? 0,
      rejected: payouts.find((p) => p._id === 'withdrawal_rejected')?.count ?? 0,
    },
  };
}

// ------------------------------------------------------------------ daily / weekly / monthly

export const PERIODS = { daily: { format: '%Y-%m-%d', defaultDays: 30 }, weekly: { format: '%G-W%V', defaultDays: 84 }, monthly: { format: '%Y-%m', defaultDays: 365 } } as const;
export type Period = keyof typeof PERIODS;

export interface ReportRow {
  period: string;
  sales: number;
  sellerCommissionsETB: number;
  buyerFeesETB: number;
  revenueETB: number;
  refundedETB: number;
}

/** Revenue is bucketed by the day the sale COMPLETED (when it was earned), in Ethiopian time. Refunds by the day they were recorded. */
export async function revenueReport(period: Period, from?: Date): Promise<ReportRow[]> {
  const since = from ?? new Date(Date.now() - PERIODS[period].defaultDays * 86_400_000);
  const bucket = { $dateToString: { format: PERIODS[period].format, date: '$settledAt', timezone: TIME_ZONE } };
  const refundBucket = { $dateToString: { format: PERIODS[period].format, date: '$createdAt', timezone: TIME_ZONE } };
  const [earned, refunds] = await Promise.all([
    LedgerEntry.aggregate<{ _id: { p: string; type: string }; total: number; count: number }>([
      { $match: { type: { $in: ['platform_commission', 'buyer_fee'] }, status: 'posted', settledAt: { $gte: since } } },
      { $group: { _id: { p: bucket, type: '$type' }, total: { $sum: '$amountETB' }, count: { $sum: 1 } } },
    ]),
    LedgerEntry.aggregate<{ _id: { p: string }; total: number }>([
      { $match: { type: 'buyer_refund', createdAt: { $gte: since } } },
      { $group: { _id: { p: refundBucket }, total: { $sum: '$amountETB' } } },
    ]),
  ]);
  const rows = new Map<string, ReportRow>();
  const row = (p: string): ReportRow => {
    let r = rows.get(p);
    if (!r) rows.set(p, (r = { period: p, sales: 0, sellerCommissionsETB: 0, buyerFeesETB: 0, revenueETB: 0, refundedETB: 0 }));
    return r;
  };
  for (const e of earned) {
    const r = row(e._id.p);
    if (e._id.type === 'platform_commission') {
      r.sellerCommissionsETB += e.total;
      r.sales += e.count;
    } else r.buyerFeesETB += e.total;
    r.revenueETB = r.sellerCommissionsETB + r.buyerFeesETB;
  }
  for (const e of refunds) row(e._id.p).refundedETB += e.total;
  return [...rows.values()].sort((a, b) => (a.period < b.period ? 1 : -1));
}

// ------------------------------------------------------------------ transaction history

export interface TxFilter {
  q?: string;
  status?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

async function buildFilter(f: TxFilter): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {};
  if (f.status) filter.status = f.status;
  if (f.from || f.to) filter.createdAt = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  const q = f.q?.trim().slice(0, 80);
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i'); // escaped: a search can never be a regex or a query operator
    const [people, listings] = await Promise.all([
      User.find({ $or: [{ name: re }, { phone: re }, { email: re }] }).select('_id').limit(50).lean(),
      Listing.find({ $or: [{ title: re }, { handle: re }, { domain: re }] }).select('_id').limit(50).lean(),
    ]);
    const ids = people.map((p) => p._id);
    filter.$or = [
      { txRef: re },
      { chapaReference: re },
      { buyer: { $in: ids } },
      { seller: { $in: ids } },
      { listing: { $in: listings.map((l) => l._id) } },
      ...(isValidObjectId(q) ? [{ _id: new Types.ObjectId(q) }] : []),
    ];
  }
  return filter;
}

type Lean = {
  _id: Types.ObjectId;
  txRef: string;
  createdAt: Date;
  status: string;
  priceETB: number;
  buyerFeeETB?: number;
  buyerFeeRate?: number;
  buyerFeeFlat?: boolean;
  commissionRate: number;
  commissionETB?: number;
  sellerEscrowETB?: number;
  paymentMethod?: string;
  chapaReference?: string;
  paidETB?: number;
  completedAt?: Date;
  listing?: { title?: string; handle?: string; domain?: string; platform?: string } | null;
  buyer?: { name?: string } | null;
  seller?: { name?: string } | null;
};

export function shapeTransaction(o: Lean) {
  const fee = o.buyerFeeETB ?? 0;
  const commission = o.commissionETB ?? 0;
  return {
    id: String(o._id),
    txRef: o.txRef,
    date: o.createdAt,
    completedAt: o.completedAt ?? null,
    status: o.status,
    listing: o.listing?.title ?? o.listing?.handle ?? o.listing?.domain ?? '',
    platform: o.listing?.platform ?? '',
    buyer: o.buyer?.name ?? '',
    seller: o.seller?.name ?? '',
    priceETB: o.priceETB,
    buyerFeeRate: o.buyerFeeRate ?? 0,
    buyerFeeFlat: !!o.buyerFeeFlat,
    buyerFeeETB: fee,
    buyerTotalETB: o.priceETB + fee,
    sellerCommissionRate: o.commissionRate,
    sellerCommissionETB: commission,
    sellerNetETB: o.sellerEscrowETB ?? 0,
    /** Earned only when the sale is COMPLETED. While it is held in escrow it is "held", and after a refund it is zero. */
    revenueETB: o.status === 'COMPLETED' ? commission + fee : 0,
    heldRevenueETB: HELD_STATUSES.includes(o.status) ? commission + fee : 0,
    refundedETB: o.status === 'REFUNDED' ? (commission > 0 ? o.priceETB + fee : o.paidETB ?? 0) : 0,
    paymentMethod: o.paymentMethod ?? '',
    providerReference: o.chapaReference ?? '',
  };
}

export async function searchTransactions(f: TxFilter) {
  const filter = await buildFilter(f);
  const limit = Math.min(Math.max(f.limit ?? 25, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const [rows, total] = await Promise.all([
    EscrowOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('listing', 'title handle domain platform')
      .populate('buyer', 'name')
      .populate('seller', 'name')
      .lean(),
    EscrowOrder.countDocuments(filter),
  ]);
  return { page, limit, total, items: (rows as unknown as Lean[]).map(shapeTransaction) };
}

export const CSV_COLUMNS = [
  { key: 'date', header: 'Date' },
  { key: 'txRef', header: 'Reference' },
  { key: 'status', header: 'Status' },
  { key: 'listing', header: 'Listing' },
  { key: 'platform', header: 'Platform' },
  { key: 'buyer', header: 'Buyer' },
  { key: 'seller', header: 'Seller' },
  { key: 'priceETB', header: 'Listing price (ETB)' },
  { key: 'buyerFeeRate', header: 'Buyer fee rate' },
  { key: 'buyerFeeETB', header: 'Buyer fee (ETB)' },
  { key: 'buyerTotalETB', header: 'Buyer total (ETB)' },
  { key: 'sellerCommissionRate', header: 'Seller commission rate' },
  { key: 'sellerCommissionETB', header: 'Seller commission (ETB)' },
  { key: 'sellerNetETB', header: 'Seller net (ETB)' },
  { key: 'revenueETB', header: 'Truth Market revenue earned (ETB)' },
  { key: 'heldRevenueETB', header: 'Revenue held in escrow (ETB)' },
  { key: 'refundedETB', header: 'Refunded to buyer (ETB)' },
  { key: 'paymentMethod', header: 'Payment method' },
  { key: 'providerReference', header: 'Provider reference' },
];

export const EXPORT_LIMIT = 10_000;

export async function exportTransactions(f: TxFilter) {
  const filter = await buildFilter(f);
  const rows = await EscrowOrder.find(filter)
    .sort({ createdAt: -1 })
    .limit(EXPORT_LIMIT)
    .populate('listing', 'title handle domain platform')
    .populate('buyer', 'name')
    .populate('seller', 'name')
    .lean();
  return (rows as unknown as Lean[]).map(shapeTransaction);
}

// ------------------------------------------------------------------ seller balances

export async function sellerBalances(limit = 100) {
  const [released, locked, wds] = await Promise.all([
    LedgerEntry.aggregate<{ _id: Types.ObjectId; total: number }>([{ $match: { type: 'seller_release' } }, { $group: { _id: '$seller', total: { $sum: '$amountETB' } } }]),
    LedgerEntry.aggregate<{ _id: Types.ObjectId; total: number }>([{ $match: { type: 'seller_escrow', status: 'locked' } }, { $group: { _id: '$seller', total: { $sum: '$amountETB' } } }]),
    Withdrawal.aggregate<{ _id: { user: Types.ObjectId; status: string }; total: number }>([
      { $match: { status: { $in: ['requested', 'paid'] } } },
      { $group: { _id: { user: '$user', status: '$status' }, total: { $sum: '$amountETB' } } },
    ]),
  ]);
  const by = new Map<string, { sellerId: string; lockedETB: number; releasedETB: number; requestedETB: number; paidETB: number }>();
  const get = (id: unknown) => {
    const k = String(id);
    let r = by.get(k);
    if (!r) by.set(k, (r = { sellerId: k, lockedETB: 0, releasedETB: 0, requestedETB: 0, paidETB: 0 }));
    return r;
  };
  for (const r of released) get(r._id).releasedETB = r.total;
  for (const r of locked) get(r._id).lockedETB = r.total;
  for (const r of wds) get(r._id.user)[r._id.status === 'paid' ? 'paidETB' : 'requestedETB'] = r.total;

  const rows = [...by.values()].map((r) => ({ ...r, availableETB: Math.max(0, r.releasedETB - r.requestedETB - r.paidETB) }));
  rows.sort((a, b) => b.availableETB + b.lockedETB - (a.availableETB + a.lockedETB));
  const top = rows.slice(0, limit);
  const users = await User.find({ _id: { $in: top.map((r) => r.sellerId) } }).select('name phone').lean();
  const name = new Map(users.map((u) => [String(u._id), u as unknown as { name: string; phone: string }]));
  return top.map((r) => ({ ...r, name: name.get(r.sellerId)?.name ?? '', phone: name.get(r.sellerId)?.phone ?? '' }));
}
