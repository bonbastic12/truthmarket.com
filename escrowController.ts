import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { Types, isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { config, paymentsMode } from '../config';
import { EscrowOrder, OrderStatus } from '../models/EscrowOrder';
import { Listing } from '../models/Listing';
import { User } from '../models/User';
import { initializeTransaction } from '../services/chapa';
import { assertSellerVerified } from '../services/kycService';
import { cancelUnpaid, completeOrder, inspectionEnd, refundOrder, settlePayment } from '../services/escrowService';
import { computeBreakdown } from '../services/money';
import { orderView } from '../services/orderView';
import { getRates } from '../services/settings';
import { ApiError, asyncHandler } from '../utils/http';

const createSchema = z.object({ listingId: z.string().refine(isValidObjectId, 'Invalid listing id') });

function loadOrder(id: string) {
  return EscrowOrder.findById(id)
    .populate('listing', 'title handle platform status')
    .populate('buyer', 'name phone')
    .populate('seller', 'name')
    .lean();
}

/** The order as THIS person may see it (see services/orderView.ts). */
async function orderFor(req: Request, id: string) {
  const o = await loadOrder(id);
  return o ? orderView(o as unknown as Record<string, unknown>, req.user!) : null;
}

/**
 * POST /api/escrow   { listingId }
 * "Buy" button: reserves the listing, creates the order, calls Chapa's initialize endpoint with the exact
 * ETB amount plus the buyer's name, email, phone and a unique tx_ref, and returns the secure checkout_url.
 */
export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const { listingId } = createSchema.parse(req.body);
  const userId = req.user!.id;

  // No payment provider configured: say so plainly instead of pretending. Nothing is created and nothing can be marked as paid.
  if (paymentsMode() === 'demo') throw new ApiError(503, 'DEMO MODE: no payment provider is configured on this server, so payments are switched off. Nothing was charged.');

  // A double click or a second tab gets the same payment link back instead of a second order.
  const pending = await EscrowOrder.findOne({ listing: listingId, buyer: userId, status: 'PENDING_PAYMENT', expiresAt: { $gt: new Date() } });
  if (pending?.checkoutUrl) {
    return res.json({ order: await orderFor(req, String(pending._id)), checkoutUrl: pending.checkoutUrl });
  }

  const buyer = await User.findById(userId).lean();
  if (!buyer) throw new ApiError(401, 'Please log in to continue');

  // The money would be stuck if the seller can no longer hand the account over, so an unverified or flagged seller cannot be bought from.
  const forSale = await Listing.findById(listingId).select('seller').lean();
  if (forSale && !(await User.exists({ _id: forSale.seller, isVerified: true }))) {
    throw new ApiError(409, 'This seller is not verified at the moment, so the listing cannot be bought. Try again later.');
  }

  // Atomic: only one buyer can flip an active listing to escrow.
  const listing = await Listing.findOneAndUpdate(
    { _id: listingId, status: 'active', seller: { $ne: userId } },
    { $set: { status: 'escrow' } },
    { new: true },
  );
  if (!listing) throw new ApiError(409, 'This account is not available for purchase');

  // The rates are read from the database (admin-editable) and COPIED onto the order below, so a later change never alters this sale.
  // The buyer pays the listed price plus the service fee, and the payment provider is asked for exactly that total.
  let rates;
  try {
    rates = await getRates();
  } catch (e) {
    await Listing.updateOne({ _id: listing._id, status: 'escrow' }, { $set: { status: 'active' } });
    throw e;
  }
  const money = computeBreakdown(listing.priceETB, rates.sellerCommissionRate, rates.buyerFeeRate);
  const buyerFee = money.buyerFeeETB;
  const totalETB = money.buyerTotalETB;
  const id = new Types.ObjectId();
  const txRef = `tm-${id.toHexString()}-${randomBytes(4).toString('hex')}`; // 36 chars, Chapa allows up to 50
  let created = false;
  try {
    await EscrowOrder.create({
      _id: id,
      txRef,
      listing: listing._id,
      buyer: userId,
      seller: listing.seller,
      priceETB: listing.priceETB,
      buyerFeeRate: rates.buyerFeeRate,
      buyerFeeETB: buyerFee,
      buyerFeeFlat: money.buyerFeeFlat,
      totalETB,
      commissionRate: rates.sellerCommissionRate,
      expiresAt: new Date(Date.now() + config.pendingTtlMs),
      timeline: [{ status: 'PENDING_PAYMENT', source: 'user', by: userId }],
    });
    created = true;

    const [firstName, ...rest] = buyer.name.trim().split(/\s+/);
    const { checkoutUrl } = await initializeTransaction({
      amountETB: totalETB,
      email: buyer.email,
      firstName,
      lastName: rest.join(' ') || 'Customer',
      phone: buyer.phone,
      txRef,
      returnUrl: `${config.clientUrl}/checkout/return?tx_ref=${encodeURIComponent(txRef)}`,
      callbackUrl: config.publicApiUrl ? `${config.publicApiUrl}/api/webhook/chapa/callback` : undefined,
    });
    await EscrowOrder.updateOne({ _id: id }, { $set: { checkoutUrl } });
    res.status(201).json({ order: await orderFor(req, String(id)), checkoutUrl });
  } catch (e) {
    // The order row is kept as CANCELLED (not deleted): if Chapa did create the transaction before the error,
    // a late payment can still be matched to it and reconciled.
    if (created) await EscrowOrder.updateOne({ _id: id, status: 'PENDING_PAYMENT' }, { $set: { status: 'CANCELLED' }, $push: { timeline: { status: 'CANCELLED', source: 'user', note: 'Payment could not be started' } } });
    await Listing.updateOne({ _id: listing._id, status: 'escrow' }, { $set: { status: 'active' } });
    throw e;
  }
});

export const listOrders = asyncHandler(async (req: Request, res: Response) => {
  const isAdmin = req.user!.role === 'admin';
  const filter: Record<string, unknown> = isAdmin ? {} : { $or: [{ buyer: req.user!.id }, { seller: req.user!.id }] };
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (status && isAdmin) filter.status = status;
  const orders = await EscrowOrder.find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('listing', 'title handle platform status')
    .populate('buyer', 'name phone')
    .populate('seller', 'name')
    .lean();
  res.json({ orders: orders.map((o) => orderView(o as unknown as Record<string, unknown>, req.user!)) });
});

async function assertInvolved(id: string, userId: string, role: string) {
  const raw = await EscrowOrder.findById(id).select('buyer seller').lean();
  if (!raw) throw new ApiError(404, 'Order not found');
  const involved = String(raw.buyer) === userId || String(raw.seller) === userId;
  if (!involved && role !== 'admin') throw new ApiError(404, 'Order not found');
}

export const getOrder = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(400, 'Invalid order id');
  await assertInvolved(id, req.user!.id, req.user!.role);
  res.json({ order: await orderFor(req, id) });
});

/**
 * GET /api/escrow/verify/:txRef
 * The page Chapa sends the buyer back to calls this. It asks Chapa directly and settles the order if it was paid,
 * so the buyer sees the right state even if the webhook is a few seconds late. Same idempotent code as the webhook.
 */
export const verifyReturn = asyncHandler(async (req: Request, res: Response) => {
  const txRef = String(req.params.txRef).slice(0, 60);
  const order = await EscrowOrder.findOne({ txRef }).select('_id buyer seller').lean();
  if (!order) throw new ApiError(404, 'Order not found');
  await assertInvolved(String(order._id), req.user!.id, req.user!.role);
  await settlePayment(txRef, 'return');
  res.json({ order: await orderFor(req, String(order._id)) });
});

const ACTIONS = ['markTransferred', 'confirmReceipt', 'dispute', 'cancel', 'refund'] as const;
type Action = (typeof ACTIONS)[number];

interface Ctx {
  isBuyer: boolean;
  isSeller: boolean;
  isAdmin: boolean;
  status: OrderStatus;
}

/**
 * What people can do AFTER the payment. Payment confirmation is deliberately not here:
 * no user and no admin button can mark an order as paid, only Chapa's verified webhook can.
 */
const RULES: Record<Action, (c: Ctx) => boolean> = {
  markTransferred: (c) => c.status === 'FUNDS_HELD_IN_ESCROW' && (c.isSeller || c.isAdmin),
  confirmReceipt: (c) => (c.status === 'TRANSFERRED' && c.isBuyer) || ((c.status === 'TRANSFERRED' || c.status === 'DISPUTED') && c.isAdmin),
  dispute: (c) => c.status === 'TRANSFERRED' && c.isBuyer,
  cancel: (c) => c.status === 'PENDING_PAYMENT' && (c.isBuyer || c.isAdmin),
  refund: (c) => c.isAdmin && ['FUNDS_HELD_IN_ESCROW', 'TRANSFERRED', 'DISPUTED', 'REFUND_REQUIRED'].includes(c.status),
};

/** POST /api/escrow/:id/:action */
export const advanceOrder = asyncHandler(async (req: Request, res: Response) => {
  const { id, action } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(400, 'Invalid order id');
  if (!(ACTIONS as readonly string[]).includes(action)) throw new ApiError(404, 'Unknown escrow action');

  const order = await EscrowOrder.findById(id).lean();
  if (!order) throw new ApiError(404, 'Order not found');
  const uid = req.user!.id;
  const ctx: Ctx = {
    isBuyer: String(order.buyer) === uid,
    isSeller: String(order.seller) === uid,
    isAdmin: req.user!.role === 'admin',
    status: order.status as OrderStatus,
  };
  if (!ctx.isBuyer && !ctx.isSeller && !ctx.isAdmin) throw new ApiError(404, 'Order not found');
  if (!RULES[action as Action](ctx)) throw new ApiError(403, 'This step is not available for this order right now');

  // A seller can only report a handover after passing the National ID + phone check (admins acting for them are exempt).
  if ((action as Action) === 'markTransferred' && ctx.isSeller && !ctx.isAdmin) await assertSellerVerified(uid);

  const now = new Date();
  let result: unknown = null;
  switch (action as Action) {
    case 'markTransferred':
      // Atomic: only moves while the funds are still held, so a double click cannot restart the timer.
      result = await EscrowOrder.findOneAndUpdate(
        { _id: id, status: 'FUNDS_HELD_IN_ESCROW' },
        {
          $set: { status: 'TRANSFERRED', transferredAt: now, inspectionEndsAt: inspectionEnd(now) },
          $push: { timeline: { status: 'TRANSFERRED', at: now, source: ctx.isAdmin ? 'admin' : 'user', by: uid } },
        },
        { new: true },
      );
      break;
    case 'confirmReceipt':
      result = await completeOrder(id, ctx.isAdmin ? 'admin' : 'user', uid);
      break;
    case 'dispute':
      result = await EscrowOrder.findOneAndUpdate(
        { _id: id, status: 'TRANSFERRED' },
        { $set: { status: 'DISPUTED' }, $push: { timeline: { status: 'DISPUTED', at: now, source: 'user', by: uid } } },
        { new: true },
      );
      break;
    case 'cancel':
      result = await cancelUnpaid(id, ctx.isAdmin ? 'admin' : 'user', uid);
      break;
    case 'refund':
      result = await refundOrder(id, uid);
      break;
  }
  if (!result) throw new ApiError(409, 'This order has already moved to another step. Refresh and try again.');
  res.json({ order: await orderFor(req, id) });
});
