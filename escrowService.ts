import { config } from '../config';
import { EscrowOrder, OrderDoc, OrderStatus } from '../models/EscrowOrder';
import { LedgerEntry } from '../models/LedgerEntry';
import { Listing } from '../models/Listing';
import { runAtomic } from './atomic';
import { verifyTransaction } from './chapa';
import { grossOf, recordFundsHeld, recordRefund, releaseSellerShare } from './ledger';
import { computeBreakdown } from './money';

type Source = 'webhook' | 'return' | 'sweeper' | 'user' | 'admin';

const event = (status: OrderStatus, source: Source, by?: string, note?: string) => ({ status, at: new Date(), source, by, note });

/** The service fee the buyer pays on top of the price (whole ETB). */
export const buyerFeeFor = (priceETB: number, rate: number) => computeBreakdown(priceETB, 0, rate).buyerFeeETB;

/** seller commission + seller net always add up exactly to the price (whole ETB). The buyer fee is separate and extra. */
export function splitAmount(priceETB: number, rate: number) {
  const b = computeBreakdown(priceETB, rate, 0);
  return { commissionETB: b.sellerCommissionETB, sellerEscrowETB: b.sellerNetETB };
}

/**
 * Turns a paid Chapa transaction into FUNDS_HELD_IN_ESCROW. Called by the webhook, the Chapa callback,
 * the buyer's return page and the background sweeper, so it is safe to run many times at once:
 *
 *  1. Chapa is asked directly (verify API) whether tx_ref was paid, and for how much.
 *  2. The state change and the ledger rows are written in one database transaction, and the status change only
 *     matches while the order is still unpaid, so exactly one caller wins and the split is applied exactly once.
 *  3. The ledger rows are inserted with a unique index, so even a repeated call cannot double-count.
 *
 * Throws only when Chapa cannot be reached (the caller should retry later).
 */
export async function settlePayment(txRef: string, source: Source): Promise<OrderDoc | null> {
  const order = await EscrowOrder.findOne({ txRef });
  if (!order) return null;

  if (order.status !== 'PENDING_PAYMENT' && order.status !== 'CANCELLED') {
    // Already settled by another caller. Make sure the ledger exists, then report the current state.
    if (!order.ledgerPosted && ['FUNDS_HELD_IN_ESCROW', 'TRANSFERRED', 'COMPLETED', 'DISPUTED'].includes(order.status)) {
      await upgradeLedger(order);
    }
    return order;
  }

  const paid = await verifyTransaction(txRef);
  if (!paid || !paid.paid) return order; // not paid (yet)

  const note = `Chapa ref ${paid.reference ?? '-'}`;

  // Wrong amount or currency: keep the money flagged for an admin, never fulfil the order.
  // The buyer must have paid exactly price + service fee (orders from before the fee only price).
  const expected = grossOf(order);
  if (paid.currency !== 'ETB' || Math.abs(paid.amount - expected) > 0.009) {
    const flagged = await EscrowOrder.findOneAndUpdate(
      { _id: order._id, status: { $in: ['PENDING_PAYMENT', 'CANCELLED'] } },
      {
        $set: { status: 'REFUND_REQUIRED', chapaReference: paid.reference, paidETB: paid.currency === 'ETB' ? Math.round(paid.amount) : 0 },
        $push: { timeline: event('REFUND_REQUIRED', source, undefined, `Paid ${paid.amount} ${paid.currency}, expected ${expected} ETB`) },
      },
      { new: true },
    );
    if (flagged) await Listing.updateOne({ _id: order.listing, status: 'escrow' }, { $set: { status: 'active' } });
    return flagged ?? (await EscrowOrder.findById(order._id));
  }

  // The order expired and was cancelled, but the buyer paid in time: try to take the listing back.
  if (order.status === 'CANCELLED') {
    const relocked = await Listing.findOneAndUpdate({ _id: order.listing, status: 'active' }, { $set: { status: 'escrow' } });
    if (!relocked) {
      const late = await EscrowOrder.findOneAndUpdate(
        { _id: order._id, status: 'CANCELLED' },
        {
          $set: { status: 'REFUND_REQUIRED', chapaReference: paid.reference, paidETB: Math.round(paid.amount) },
          $push: { timeline: event('REFUND_REQUIRED', source, undefined, 'Paid after the order expired and the listing is no longer available') },
        },
        { new: true },
      );
      return late ?? (await EscrowOrder.findById(order._id));
    }
  }

  // The split uses the rate copied onto the order when it was created, never today's setting.
  const { commissionETB, sellerEscrowETB } = splitAmount(order.priceETB, order.commissionRate);

  // ONE transaction: the status change and every ledger row commit together or not at all.
  // (Idempotent as well: the status filter lets exactly one caller win, and the ledger rows are unique per order.)
  return runAtomic(async (session) => {
    const updated = await EscrowOrder.findOneAndUpdate(
      { _id: order._id, status: { $in: ['PENDING_PAYMENT', 'CANCELLED'] } },
      {
        $set: {
          status: 'FUNDS_HELD_IN_ESCROW',
          fundsHeldAt: new Date(),
          commissionETB,
          sellerEscrowETB,
          paidETB: Math.round(paid.amount),
          paymentMethod: paid.method,
          chapaReference: paid.reference,
        },
        $push: { timeline: event('FUNDS_HELD_IN_ESCROW', source, undefined, note) },
      },
      { new: true, session },
    );
    if (!updated) return EscrowOrder.findById(order._id).session(session ?? null); // another caller won the race
    await recordFundsHeld(updated, session);
    return updated;
  });
}

/** Buyer confirmed, admin resolved a dispute, or the inspection window ended: release the seller's net proceeds and recognise the revenue. */
export async function completeOrder(orderId: string, source: Source, by?: string): Promise<OrderDoc | null> {
  const now = new Date();
  return runAtomic(async (session) => {
    const done = await EscrowOrder.findOneAndUpdate(
      { _id: orderId, status: { $in: ['TRANSFERRED', 'DISPUTED'] } },
      {
        $set: { status: 'COMPLETED', completedAt: now, autoReleased: source === 'sweeper' },
        $push: { timeline: event('COMPLETED', source, by, source === 'sweeper' ? 'Inspection window ended without a dispute' : undefined) },
      },
      { new: true, session },
    );
    if (!done) return null;
    await Listing.updateOne({ _id: done.listing }, { $set: { status: 'sold', soldAt: now } }, { session });
    await releaseSellerShare(done, session);
    return done;
  });
}

/**
 * Admin refunds the buyer (the money itself is sent from the Chapa dashboard) and the listing goes back on sale.
 * The buyer gets everything back (price + fee), the seller's share returns, and the commission and fee are reversed.
 */
export async function refundOrder(orderId: string, by: string): Promise<OrderDoc | null> {
  return runAtomic(async (session) => {
    const done = await EscrowOrder.findOneAndUpdate(
      { _id: orderId, status: { $in: ['FUNDS_HELD_IN_ESCROW', 'TRANSFERRED', 'DISPUTED', 'REFUND_REQUIRED'] } },
      { $set: { status: 'REFUNDED' }, $push: { timeline: event('REFUNDED', 'admin', by, 'Buyer refunded') } },
      { new: true, session },
    );
    if (!done) return null;
    await recordRefund(done, session);
    await Listing.updateOne({ _id: done.listing, status: 'escrow' }, { $set: { status: 'active' } }, { session });
    return done;
  });
}

/** Cancels an unpaid order and puts the listing back on sale. */
export async function cancelUnpaid(orderId: string, source: Source, by?: string, note?: string): Promise<OrderDoc | null> {
  const done = await EscrowOrder.findOneAndUpdate(
    { _id: orderId, status: 'PENDING_PAYMENT' },
    { $set: { status: 'CANCELLED' }, $push: { timeline: event('CANCELLED', source, by, note) } },
    { new: true },
  );
  if (!done) return null;
  await Listing.updateOne({ _id: done.listing, status: 'escrow' }, { $set: { status: 'active' } });
  return done;
}

/** Background work, run every minute (and safe to run on several servers at once). */
export async function runSweep(): Promise<void> {
  const now = new Date();

  // 1. Unpaid orders past their reservation: check Chapa one last time, otherwise release the listing.
  const stale = await EscrowOrder.find({ status: 'PENDING_PAYMENT', expiresAt: { $lte: now } }).limit(50);
  for (const o of stale) {
    try {
      const settled = await settlePayment(o.txRef, 'sweeper');
      if (settled?.status === 'PENDING_PAYMENT') await cancelUnpaid(String(o._id), 'sweeper', undefined, 'Payment window expired');
    } catch (e) {
      console.error(`Sweep: could not check ${o.txRef}, will retry`, (e as Error).message);
    }
  }

  // 2. Inspection window over, no dispute: release the seller's share automatically.
  const due = await EscrowOrder.find({ status: 'TRANSFERRED', inspectionEndsAt: { $lte: now } }).select('_id').limit(50);
  for (const o of due) {
    try {
      await completeOrder(String(o._id), 'sweeper');
    } catch (e) {
      console.error('Sweep: auto release failed', (e as Error).message);
    }
  }

  // 3. Repair / upgrade ledgers: finishes a payment the server stopped in the middle of, and brings orders written
  //    before this release up to the current rules. Safe to repeat: every row is unique per order.
  const gaps = await EscrowOrder.find({
    $or: [
      { status: { $in: ['FUNDS_HELD_IN_ESCROW', 'TRANSFERRED', 'COMPLETED', 'DISPUTED'] }, ledgerPosted: false },
      { status: { $in: ['FUNDS_HELD_IN_ESCROW', 'TRANSFERRED', 'COMPLETED', 'DISPUTED', 'REFUNDED'] }, ledgerPosted: true, ledgerVersion: { $ne: 2 } },
    ],
  }).limit(50);
  for (const o of gaps) {
    try {
      await upgradeLedger(o);
    } catch (e) {
      console.error(`Sweep: ledger repair failed for order ${o._id}, will retry`, (e as Error).message);
    }
  }
}

/** Makes the ledger of one order match its status, whatever state it was left in. Idempotent. */
export async function upgradeLedger(o: OrderDoc): Promise<void> {
  await runAtomic(async (session) => {
    if (['FUNDS_HELD_IN_ESCROW', 'TRANSFERRED', 'COMPLETED', 'DISPUTED'].includes(o.status)) {
      await recordFundsHeld(o, session);
      if (o.status !== 'COMPLETED') {
        // Rows from before this release were already "posted"; revenue is only earned on completion, so they go back to pending.
        await LedgerEntry.updateMany({ order: o._id, type: { $in: ['platform_commission', 'buyer_fee'] }, status: 'posted' }, { $set: { status: 'pending' }, $unset: { settledAt: '' } }, { session });
      }
    }
    if (o.status === 'COMPLETED') {
      await releaseSellerShare(o, session);
      await LedgerEntry.updateMany({ order: o._id, type: { $in: ['platform_commission', 'buyer_fee'] }, status: 'posted', settledAt: { $exists: false } }, { $set: { settledAt: o.completedAt ?? new Date() } }, { session });
    }
    if (o.status === 'REFUNDED') await recordRefund(o, session);
    await EscrowOrder.updateOne({ _id: o._id }, { $set: { ledgerVersion: 2 } }, { session });
  });
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startSweeper(): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runSweep();
    } catch (e) {
      console.error('Sweep failed', e);
    } finally {
      running = false;
    }
  }, 60_000);
  timer.unref();
}

export const inspectionEnd = (from: Date) => new Date(from.getTime() + config.inspectionMs);
