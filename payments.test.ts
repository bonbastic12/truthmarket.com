import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import adminRoutes from '../src/routes/adminRoutes';
import escrowRoutes from '../src/routes/escrowRoutes';
import walletRoutes from '../src/routes/walletRoutes';
import webhookRoutes from '../src/routes/webhookRoutes';
import { EscrowOrder } from '../src/models/EscrowOrder';
import { Withdrawal } from '../src/models/Withdrawal';
import { PayoutEntry } from '../src/models/PayoutEntry';
import { adminDecideWithdrawal, getWallet } from '../src/services/payoutService';
import { runSweep, settlePayment } from '../src/services/escrowService';
import { recordFundsHeld, releaseSellerShare } from '../src/services/ledger';
import { revenueSummary, searchTransactions } from '../src/services/revenueService';
import { Actors, call, db, freshWorld, makeListing, provider, signedWebhook } from './helpers';

let w: Actors;
beforeEach(async () => {
  w = await freshWorld();
  provider.reset();
});

/** The buyer presses Buy: real createOrder controller, real provider call (scripted). */
async function buy(price: number, buyer = w.buyer) {
  const listingId = await makeListing(w.seller.id, price, `Channel ${price} ${Math.random().toString(36).slice(2, 6)}`);
  const r = await call(escrowRoutes, 'POST', '/', { token: buyer.token, body: { listingId } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const order = await EscrowOrder.findById(r.body.order._id).lean();
  return { listingId, orderId: String(order!._id), txRef: order!.txRef, response: r };
}
const webhook = (txRef: string, event?: string) => {
  const { rawBody, headers } = signedWebhook(txRef, event);
  return call(webhookRoutes, 'POST', '/chapa', { rawBody, headers });
};
const ledger = (orderId: string) => db.all('LedgerEntry').filter((r: { order: unknown }) => String(r.order) === orderId);
const row = (orderId: string, type: string) => ledger(orderId).find((r: { type: string }) => r.type === type);
/** Seller reports the handover, buyer confirms: the sale completes. */
async function complete(orderId: string) {
  const t = await call(escrowRoutes, 'POST', `/${orderId}/markTransferred`, { token: w.seller.token });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const c = await call(escrowRoutes, 'POST', `/${orderId}/confirmReceipt`, { token: w.buyer.token });
  assert.equal(c.status, 200, JSON.stringify(c.body));
}

describe('small sales: flat 100 ETB buyer fee under 1,000 ETB', () => {
  it('a 150 ETB listing: buyer pays 250, provider asked for 250, seller still gets 90% of 150, revenue 115 after completion', async () => {
    const { response, orderId, txRef } = await buy(150);
    const o = response.body.order;
    assert.equal(o.buyerFeeETB, 100);
    assert.equal(o.totalETB, 250);
    assert.equal(o.buyerFeeFlat, true);
    assert.equal(provider.initialized[0].amount, 250);
    provider.pay(txRef, { amount: 250 });
    assert.equal((await webhook(txRef)).status, 200);
    assert.equal(row(orderId, 'buyer_fee').amountETB, 100);
    assert.equal(row(orderId, 'platform_commission').amountETB, 15);
    assert.equal(row(orderId, 'seller_escrow').amountETB, 135);
    await complete(orderId);
    assert.equal(row(orderId, 'trustmedia_revenue').amountETB, 115);
  });

  it('a 1,000 ETB listing uses the 5% fee again (50)', async () => {
    const { response } = await buy(1_000);
    assert.equal(response.body.order.buyerFeeETB, 50);
    assert.equal(response.body.order.totalETB, 1_050);
    assert.equal(response.body.order.buyerFeeFlat, false);
  });
});

describe('the exact example: 10,000 ETB listing', () => {
  it('buyer checkout: price 10,000 + fee 500 = 10,500, and the provider is asked for exactly 10,500', async () => {
    const { response, txRef } = await buy(10_000);
    const o = response.body.order;
    assert.equal(o.priceETB, 10_000);
    assert.equal(o.buyerFeeETB, 500);
    assert.equal(o.totalETB, 10_500);
    assert.equal(provider.initialized.length, 1);
    assert.equal(provider.initialized[0].txRef, txRef);
    assert.equal(provider.initialized[0].amount, 10_500, 'amount requested from the provider must equal the displayed checkout total');
    assert.equal(provider.initialized[0].currency, 'ETB');
    assert.ok(String(response.body.checkoutUrl).startsWith('https://checkout.chapa.co/'));
  });

  it('after the verified payment: ledger holds every figure separately, revenue is held but not yet earned', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef);
    assert.equal((await webhook(txRef)).status, 200);

    const order = await EscrowOrder.findById(orderId).lean();
    assert.equal(order!.status, 'FUNDS_HELD_IN_ESCROW');
    const get = (t: string) => row(orderId, t);
    assert.equal(get('listing_price').amountETB, 10_000);
    assert.equal(get('payment_received').amountETB, 10_500);
    assert.equal(get('platform_commission').amountETB, 1_000);
    assert.equal(get('platform_commission').status, 'pending');
    assert.equal(get('buyer_fee').amountETB, 500);
    assert.equal(get('buyer_fee').status, 'pending');
    assert.equal(get('seller_escrow').amountETB, 9_000);
    assert.equal(get('seller_escrow').status, 'locked');
    assert.equal(get('trustmedia_revenue'), undefined, 'revenue is only recognised when the sale completes');

    const s = await revenueSummary();
    assert.equal(s.grossVolumeETB, 10_500);
    assert.equal(s.combinedRevenueETB, 0);
    assert.equal(s.heldRevenueETB, 1_500);
    assert.equal(s.verifiedInEscrow.count, 1);
    assert.equal((await getWallet(w.seller.id)).availableETB, 0, 'nothing is payable before the sale completes');
    assert.equal((await getWallet(w.seller.id)).lockedETB, 9_000);
  });

  it('after completion: commission 1,000 + buyer fee 500 = 1,500 revenue; seller is credited exactly 9,000', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef);
    await webhook(txRef);
    await complete(orderId);

    assert.equal(row(orderId, 'seller_release').amountETB, 9_000);
    assert.equal(row(orderId, 'platform_commission').status, 'posted');
    assert.equal(row(orderId, 'buyer_fee').status, 'posted');
    assert.equal(row(orderId, 'trustmedia_revenue').amountETB, 1_500);

    const s = await revenueSummary();
    assert.equal(s.grossVolumeETB, 10_500);
    assert.equal(s.sellerCommissionsETB, 1_000);
    assert.equal(s.buyerFeesETB, 500);
    assert.equal(s.combinedRevenueETB, 1_500);
    assert.equal(s.reconciled, true);
    assert.equal(s.completedVerifiedPayments.count, 1);
    assert.equal(s.completedVerifiedPayments.total, 10_500);
    assert.equal(s.heldRevenueETB, 0);

    // The seller is credited ONLY the net: not 10,000, not 9,500, not 8,500.
    const wallet = await getWallet(w.seller.id);
    assert.equal(wallet.availableETB, 9_000);
    assert.equal(wallet.releasedETB, 9_000);
    assert.equal(wallet.lockedETB, 0);

    // Money in = money out + revenue, to the birr.
    assert.equal(row(orderId, 'payment_received').amountETB, row(orderId, 'seller_release').amountETB + row(orderId, 'trustmedia_revenue').amountETB);
  });
});

describe('verified payments only', () => {
  it('a webhook cannot mark an order paid unless the provider confirms it (forged signature rejected, claim without payment ignored)', async () => {
    const { orderId, txRef } = await buy(10_000);

    const forged = await call(webhookRoutes, 'POST', '/chapa', { rawBody: JSON.stringify({ event: 'charge.success', tx_ref: txRef }), headers: { 'x-chapa-signature': 'deadbeef' } });
    assert.equal(forged.status, 401);
    const unsigned = await call(webhookRoutes, 'POST', '/chapa', { rawBody: JSON.stringify({ event: 'charge.success', tx_ref: txRef }) });
    assert.equal(unsigned.status, 401);

    // A correctly signed "success" event while the provider says the buyer has NOT paid.
    const claim = await webhook(txRef);
    assert.equal(claim.status, 200);
    assert.equal((await EscrowOrder.findById(orderId).lean())!.status, 'PENDING_PAYMENT');
    assert.equal(ledger(orderId).length, 0);
    assert.equal((await revenueSummary()).grossVolumeETB, 0);
  });

  it('there is no endpoint or action that marks an order paid from a click (buyer, seller and admin all refused)', async () => {
    const { orderId } = await buy(10_000);
    for (const who of [w.buyer, w.seller, w.admin]) {
      for (const action of ['markPaid', 'confirmPayment', 'paid', 'settle']) {
        const r = await call(escrowRoutes, 'POST', `/${orderId}/${action}`, { token: who.token });
        assert.equal(r.status, 404, `${action} must not exist`);
      }
    }
    // The only real actions are refused while unpaid.
    for (const action of ['markTransferred', 'confirmReceipt', 'dispute', 'refund']) {
      const r = await call(escrowRoutes, 'POST', `/${orderId}/${action}`, { token: w.admin.token });
      assert.equal(r.status, 403, action);
    }
    assert.equal((await EscrowOrder.findById(orderId).lean())!.status, 'PENDING_PAYMENT');
    assert.equal(ledger(orderId).length, 0);
  });

  it('failed payment: no ledger rows, no seller credit, no revenue, order never completes', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef, { status: 'failed' });
    assert.equal((await webhook(txRef)).status, 200);
    await settlePayment(txRef, 'return');
    await settlePayment(txRef, 'sweeper');

    assert.equal((await EscrowOrder.findById(orderId).lean())!.status, 'PENDING_PAYMENT');
    assert.equal(ledger(orderId).length, 0);
    const s = await revenueSummary();
    assert.deepEqual([s.grossVolumeETB, s.combinedRevenueETB, s.sellerCommissionsETB, s.buyerFeesETB, s.heldRevenueETB], [0, 0, 0, 0, 0]);
    assert.deepEqual(await getWallet(w.seller.id), { lockedETB: 0, releasedETB: 0, pendingETB: 0, paidETB: 0, availableETB: 0, minWithdrawalETB: 100 });
    assert.equal(s.pendingPayments.count, 1);

    // The sweeper later expires the unpaid order and puts the listing back on sale, still without any money entries.
    await EscrowOrder.updateOne({ _id: orderId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await runSweep();
    assert.equal((await EscrowOrder.findById(orderId).lean())!.status, 'CANCELLED');
    assert.equal(ledger(orderId).length, 0);
  });

  it('provider unreachable: the webhook answers 500 so the provider retries, and nothing is recorded', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef);
    provider.unreachable = true;
    assert.equal((await webhook(txRef)).status, 500);
    assert.equal(ledger(orderId).length, 0);
    provider.unreachable = false;
    assert.equal((await webhook(txRef)).status, 200);
    assert.equal(row(orderId, 'seller_escrow').amountETB, 9_000);
  });

  it('wrong amount paid (10,000 instead of 10,500): flagged for refund, never fulfilled, no commission, no seller credit', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef, { amount: 10_000 });
    await webhook(txRef);
    const o = await EscrowOrder.findById(orderId).lean();
    assert.equal(o!.status, 'REFUND_REQUIRED');
    assert.equal(ledger(orderId).length, 0);
    assert.equal((await revenueSummary()).combinedRevenueETB, 0);
    assert.equal((await getWallet(w.seller.id)).lockedETB, 0);

    // The admin refunds what actually arrived (10,000), with no commission involved.
    const r = await call(escrowRoutes, 'POST', `/${orderId}/refund`, { token: w.admin.token });
    assert.equal(r.status, 200);
    assert.equal(row(orderId, 'buyer_refund').amountETB, 10_000);
    assert.equal(row(orderId, 'commission_reversal'), undefined);
    assert.equal((await revenueSummary()).combinedRevenueETB, 0);
  });
});

describe('duplicate payment notifications', () => {
  it('the same webhook delivered many times creates exactly one set of entries and one seller credit', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef);
    for (let i = 0; i < 4; i++) assert.equal((await webhook(txRef)).status, 200);
    await settlePayment(txRef, 'return');
    const callback = await call(webhookRoutes, 'GET', `/chapa/callback?trx_ref=${txRef}`);
    assert.equal(callback.status, 200);

    const rows = ledger(orderId);
    assert.equal(rows.length, 5, 'listing_price, payment_received, commission, buyer_fee, seller_escrow: one each');
    assert.equal(new Set(rows.map((r: { type: string }) => r.type)).size, 5);
    assert.equal((await getWallet(w.seller.id)).lockedETB, 9_000);

    await complete(orderId);
    for (let i = 0; i < 3; i++) await webhook(txRef); // late duplicates after completion
    assert.equal(ledger(orderId).filter((r: { type: string }) => r.type === 'trustmedia_revenue').length, 1);
    const s = await revenueSummary();
    assert.equal(s.combinedRevenueETB, 1_500);
    assert.equal(s.grossVolumeETB, 10_500);
    assert.equal((await getWallet(w.seller.id)).availableETB, 9_000);
  });

  it('webhook, return page and callback arriving at the same instant still settle exactly once', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef);
    await Promise.all([webhook(txRef), webhook(txRef), settlePayment(txRef, 'return'), settlePayment(txRef, 'sweeper'), call(webhookRoutes, 'GET', `/chapa/callback?trx_ref=${txRef}`)]);
    assert.equal(ledger(orderId).length, 5);
    assert.equal((await EscrowOrder.findById(orderId).lean())!.timeline.filter((t: { status: string }) => t.status === 'FUNDS_HELD_IN_ESCROW').length, 1);
    assert.equal((await revenueSummary()).heldRevenueETB, 1_500);
  });

  it('even when the ledger functions themselves are replayed (retry, repair job) no entry or credit is duplicated', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef);
    await webhook(txRef);
    await complete(orderId);
    const order = (await EscrowOrder.findById(orderId).lean())!;
    const before = JSON.stringify(ledger(orderId).map((r: { type: string; amountETB: number; status: string }) => [r.type, r.amountETB, r.status]).sort());
    for (let i = 0; i < 3; i++) {
      await recordFundsHeld(order as never);
      await releaseSellerShare(order as never);
    }
    assert.equal(JSON.stringify(ledger(orderId).map((r: { type: string; amountETB: number; status: string }) => [r.type, r.amountETB, r.status]).sort()), before);
    assert.equal(ledger(orderId).length, 7);
    assert.equal((await getWallet(w.seller.id)).availableETB, 9_000);
    assert.equal((await revenueSummary()).combinedRevenueETB, 1_500);
  });

  it('a second confirmation of the same completed sale does not release twice', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef);
    await webhook(txRef);
    await complete(orderId);
    const again = await call(escrowRoutes, 'POST', `/${orderId}/confirmReceipt`, { token: w.admin.token });
    assert.ok([403, 409].includes(again.status), `a repeat must be refused, got ${again.status}`);
    assert.equal((await getWallet(w.seller.id)).releasedETB, 9_000);
    assert.equal((await revenueSummary()).combinedRevenueETB, 1_500);
  });
});

describe('refunds and reversals', () => {
  it('refund while held in escrow: buyer gets 10,500 back, commission 1,000 and fee 500 are reversed, seller gets nothing, revenue is zero', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef);
    await webhook(txRef);

    const r = await call(escrowRoutes, 'POST', `/${orderId}/refund`, { token: w.admin.token });
    assert.equal(r.status, 200);
    assert.equal(row(orderId, 'buyer_refund').amountETB, 10_500);
    assert.equal(row(orderId, 'commission_reversal').amountETB, 1_000);
    assert.equal(row(orderId, 'fee_reversal').amountETB, 500);
    assert.equal(row(orderId, 'platform_commission').status, 'reversed');
    assert.equal(row(orderId, 'buyer_fee').status, 'reversed');
    assert.equal(row(orderId, 'seller_escrow').status, 'refunded');
    assert.equal(row(orderId, 'seller_release'), undefined);
    assert.equal(row(orderId, 'trustmedia_revenue'), undefined);

    const s = await revenueSummary();
    assert.equal(s.combinedRevenueETB, 0);
    assert.equal(s.sellerCommissionsETB, 0);
    assert.equal(s.buyerFeesETB, 0);
    assert.equal(s.refunds.total, 10_500);
    assert.equal(s.reversedCommissionsETB, 1_000);
    assert.equal(s.reversedBuyerFeesETB, 500);
    assert.equal(s.heldRevenueETB, 0);
    const wallet = await getWallet(w.seller.id);
    assert.deepEqual([wallet.lockedETB, wallet.releasedETB, wallet.availableETB], [0, 0, 0]);

    // Repeating the refund (double click, retry) changes nothing.
    const again = await call(escrowRoutes, 'POST', `/${orderId}/refund`, { token: w.admin.token });
    assert.ok([403, 409].includes(again.status), `a repeat must be refused, got ${again.status}`);
    assert.equal(ledger(orderId).length, 8);
    assert.equal((await revenueSummary()).refunds.total, 10_500);
  });

  it('a completed sale cannot be refunded through the escrow flow, so earned revenue is never silently removed', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef);
    await webhook(txRef);
    await complete(orderId);
    const r = await call(escrowRoutes, 'POST', `/${orderId}/refund`, { token: w.admin.token });
    assert.equal(r.status, 403);
    assert.equal((await revenueSummary()).combinedRevenueETB, 1_500);
  });

  it('a refund of one sale leaves other sales untouched', async () => {
    const a = await buy(10_000);
    const b = await buy(4_000);
    for (const x of [a, b]) {
      provider.pay(x.txRef);
      await webhook(x.txRef);
    }
    await complete(b.orderId);
    await call(escrowRoutes, 'POST', `/${a.orderId}/refund`, { token: w.admin.token });
    const s = await revenueSummary();
    assert.equal(s.combinedRevenueETB, 600); // 4,000 * 10% + 4,000 * 5%
    assert.equal(s.refunds.total, 10_500);
    assert.equal(s.grossVolumeETB, 10_500 + 4_200);
    assert.equal((await getWallet(w.seller.id)).availableETB, 3_600);
  });
});

describe('commission rates are stored in the database and snapshotted per order', () => {
  it('the rates default to 10% / 5% in the database', async () => {
    const r = await call(adminRoutes, 'GET', '/settings/commission', { token: w.admin.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.sellerCommissionRate, 0.1);
    assert.equal(r.body.buyerFeeRate, 0.05);
    const stored = db.all('PlatformSettings')[0];
    assert.equal(stored.sellerCommissionBps, 1000);
    assert.equal(stored.buyerFeeBps, 500);
  });

  it('changing the rates later does not change an order that already exists, and new orders use the new rates', async () => {
    const old = await buy(10_000);
    const put = await call(adminRoutes, 'PUT', '/settings/commission', { token: w.admin.token, body: { sellerCommissionPct: 20, buyerFeePct: 8 } });
    assert.equal(put.status, 200);
    assert.equal(put.body.sellerCommissionRate, 0.2);
    assert.equal(put.body.history.length, 1);
    assert.equal(put.body.history[0].previousSellerCommissionRate, 0.1);

    // The old order is paid AFTER the change: it must still use 10% / 5%.
    provider.pay(old.txRef);
    await webhook(old.txRef);
    await complete(old.orderId);
    assert.equal(row(old.orderId, 'platform_commission').amountETB, 1_000);
    assert.equal(row(old.orderId, 'buyer_fee').amountETB, 500);
    assert.equal(row(old.orderId, 'seller_release').amountETB, 9_000);
    const oldOrder = await EscrowOrder.findById(old.orderId).lean();
    assert.equal(oldOrder!.commissionRate, 0.1);
    assert.equal(oldOrder!.buyerFeeRate, 0.05);

    // A new order created after the change uses 20% / 8%.
    const fresh = await buy(10_000);
    assert.equal(fresh.response.body.order.totalETB, 10_800);
    assert.equal(provider.initialized.find((i) => i.txRef === fresh.txRef)!.amount, 10_800);
    provider.pay(fresh.txRef);
    await webhook(fresh.txRef);
    assert.equal(row(fresh.orderId, 'platform_commission').amountETB, 2_000);
    assert.equal(row(fresh.orderId, 'buyer_fee').amountETB, 800);
    assert.equal(row(fresh.orderId, 'seller_escrow').amountETB, 8_000);

    // History still shows each sale's own rates.
    const tx = await searchTransactions({});
    const oldRow = tx.items.find((t) => t.id === old.orderId)!;
    const newRow = tx.items.find((t) => t.id === fresh.orderId)!;
    assert.deepEqual([oldRow.sellerCommissionRate, oldRow.buyerFeeRate, oldRow.revenueETB], [0.1, 0.05, 1_500]);
    assert.deepEqual([newRow.sellerCommissionRate, newRow.buyerFeeRate, newRow.heldRevenueETB], [0.2, 0.08, 2_800]);
  });
});

describe('atomic database transactions', () => {
  it('if writing the ledger fails half way, the status change is rolled back too, and a retry succeeds exactly once', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef);
    let n = 0;
    db.failOnce('LedgerEntry', 'updateOne', () => ++n === 3, 'disk full');

    const failed = await webhook(txRef);
    assert.equal(failed.status, 500, 'the provider is told to retry');
    assert.equal((await EscrowOrder.findById(orderId).lean())!.status, 'PENDING_PAYMENT', 'status rolled back');
    assert.equal(ledger(orderId).length, 0, 'partial ledger rolled back');
    assert.equal((await getWallet(w.seller.id)).lockedETB, 0);

    assert.equal((await webhook(txRef)).status, 200); // the provider retries
    assert.equal(ledger(orderId).length, 5);
    assert.equal((await EscrowOrder.findById(orderId).lean())!.status, 'FUNDS_HELD_IN_ESCROW');
  });

  it('a failure while completing a sale rolls back the release and the revenue together', async () => {
    const { orderId, txRef } = await buy(10_000);
    provider.pay(txRef);
    await webhook(txRef);
    await call(escrowRoutes, 'POST', `/${orderId}/markTransferred`, { token: w.seller.token });
    let n = 0;
    db.failOnce('LedgerEntry', 'updateOne', () => ++n === 4, 'crash');
    const r = await call(escrowRoutes, 'POST', `/${orderId}/confirmReceipt`, { token: w.buyer.token });
    assert.equal(r.status, 500);
    assert.equal((await EscrowOrder.findById(orderId).lean())!.status, 'TRANSFERRED');
    assert.equal(row(orderId, 'seller_release'), undefined);
    assert.equal(row(orderId, 'trustmedia_revenue'), undefined);
    assert.equal((await getWallet(w.seller.id)).availableETB, 0);

    const ok = await call(escrowRoutes, 'POST', `/${orderId}/confirmReceipt`, { token: w.buyer.token });
    assert.equal(ok.status, 200);
    assert.equal((await revenueSummary()).combinedRevenueETB, 1_500);
  });
});

describe('orders written before this release are upgraded safely', () => {
  it('a legacy completed order (no revenue row, commission already "posted") is repaired exactly once by the sweeper', async () => {
    // Build the old format by hand: no listing_price / revenue rows, ledgerVersion 1, commission row already "posted" without settledAt.
    const listingId = await makeListing(w.seller.id, 10_000, 'Legacy');
    const id = new db.ObjectId();
    await EscrowOrder.create({ _id: id, txRef: 'tm-legacy', listing: listingId, buyer: w.buyer.id, seller: w.seller.id, priceETB: 10_000, buyerFeeRate: 0.05, buyerFeeETB: 500, totalETB: 10_500, commissionRate: 0.1, commissionETB: 1_000, sellerEscrowETB: 9_000, status: 'COMPLETED', completedAt: new Date(), expiresAt: new Date(), ledgerPosted: true });
    const { LedgerEntry } = await import('../src/models/LedgerEntry');
    const base = { order: id, seller: w.seller.id, listing: listingId };
    await LedgerEntry.create([
      { ...base, type: 'payment_received', account: 'platform_clearing', direction: 'credit', amountETB: 10_500, status: 'posted' },
      { ...base, type: 'platform_commission', account: 'platform_revenue', direction: 'credit', amountETB: 1_000, status: 'posted' },
      { ...base, type: 'buyer_fee', account: 'platform_revenue', direction: 'credit', amountETB: 500, status: 'posted' },
      { ...base, type: 'seller_escrow', account: 'seller_escrow', direction: 'credit', amountETB: 9_000, status: 'released' },
      { ...base, type: 'seller_release', account: 'seller_payable', direction: 'credit', amountETB: 9_000, status: 'posted' },
    ]);
    await runSweep();
    await runSweep(); // twice: must not duplicate
    const s = await revenueSummary();
    assert.equal(s.combinedRevenueETB, 1_500);
    assert.equal(s.sellerCommissionsETB, 1_000);
    assert.equal(s.buyerFeesETB, 500);
    assert.equal(s.reconciled, true);
    assert.equal((await getWallet(w.seller.id)).releasedETB, 9_000);
    assert.equal(db.all('LedgerEntry').filter((r: { type: string }) => r.type === 'trustmedia_revenue').length, 1);
  });
});

describe('withdrawals and payouts are recorded in the ledger once', () => {
  it('paying a withdrawal writes one payout record; a repeated decision is refused and records nothing more', async () => {
    const wd = await Withdrawal.create({ user: w.seller.id, amountETB: 9_000, method: 'telebirr', accountName: 'Seller', accountEnc: 'enc', accountLast4: '0001' });
    await PayoutEntry.updateOne({ withdrawal: wd._id, type: 'withdrawal_requested' }, { $setOnInsert: { withdrawal: wd._id, user: w.seller.id, type: 'withdrawal_requested', amountETB: 9_000 } }, { upsert: true });

    const done = await adminDecideWithdrawal(w.admin.id, String(wd._id), 'paid', 'TXN-123456');
    assert.equal(done.status, 'paid');
    await assert.rejects(() => adminDecideWithdrawal(w.admin.id, String(wd._id), 'paid', 'TXN-123456'), /already decided/);
    await assert.rejects(() => adminDecideWithdrawal(w.admin.id, String(wd._id), 'reject', 'changed my mind'), /already decided/);

    const entries = db.all('PayoutEntry');
    assert.deepEqual(entries.map((e: { type: string }) => e.type).sort(), ['payout_completed', 'withdrawal_requested']);
    assert.equal(entries.find((e: { type: string }) => e.type === 'payout_completed').reference, 'TXN-123456');
    const s = await revenueSummary();
    assert.equal(s.payoutRecords.completed, 1);
    assert.equal(s.sellerPayables.paidOut.total, 9_000);
  });
});
