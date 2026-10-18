import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import adminRoutes from '../src/routes/adminRoutes';
import escrowRoutes from '../src/routes/escrowRoutes';
import webhookRoutes from '../src/routes/webhookRoutes';
import { EscrowOrder } from '../src/models/EscrowOrder';
import { Withdrawal } from '../src/models/Withdrawal';
import { Actors, call, freshWorld, makeListing, provider, signedWebhook } from './helpers';

let w: Actors;
beforeEach(async () => {
  w = await freshWorld();
  provider.reset();
});

async function sale(price: number, title: string, finish: 'complete' | 'held' | 'unpaid' | 'refund' = 'complete') {
  const listingId = await makeListing(w.seller.id, price, title);
  const r = await call(escrowRoutes, 'POST', '/', { token: w.buyer.token, body: { listingId } });
  const order = (await EscrowOrder.findById(r.body.order._id).lean())!;
  if (finish === 'unpaid') return order;
  provider.pay(order.txRef);
  const { rawBody, headers } = signedWebhook(order.txRef);
  await call(webhookRoutes, 'POST', '/chapa', { rawBody, headers });
  if (finish === 'refund') await call(escrowRoutes, 'POST', `/${order._id}/refund`, { token: w.admin.token });
  if (finish === 'complete') {
    await call(escrowRoutes, 'POST', `/${order._id}/markTransferred`, { token: w.seller.token });
    await call(escrowRoutes, 'POST', `/${order._id}/confirmReceipt`, { token: w.buyer.token });
  }
  return order;
}
const get = (url: string) => call(adminRoutes, 'GET', url, { token: w.admin.token });

describe('Truth Market Commission & Revenue dashboard figures', () => {
  it('summarises every required figure from a mix of sales', async () => {
    await sale(10_000, 'Completed One'); // revenue 1,500
    await sale(4_000, 'Completed Two'); // revenue 600
    await sale(2_000, 'Held In Escrow', 'held'); // held revenue 300
    await sale(6_000, 'Refunded', 'refund'); // refund 6,300
    await sale(3_000, 'Never Paid', 'unpaid'); // pending payment 3,150
    await Withdrawal.create({ user: w.seller.id, amountETB: 5_000, method: 'telebirr', accountName: 'S', accountEnc: 'e', accountLast4: '0001', status: 'requested' });
    await Withdrawal.create({ user: w.seller.id, amountETB: 1_000, method: 'cbe', accountName: 'S', accountEnc: 'e', accountLast4: '0002', status: 'paid' });

    const s = (await get('/revenue/summary')).body;
    assert.equal(s.grossVolumeETB, 10_500 + 4_200 + 2_100 + 6_300);
    assert.equal(s.sellerCommissionsETB, 1_000 + 400);
    assert.equal(s.buyerFeesETB, 500 + 200);
    assert.equal(s.combinedRevenueETB, 2_100);
    assert.equal(s.reconciled, true);
    assert.equal(s.completedSales, 2);
    assert.deepEqual(s.completedVerifiedPayments, { total: 14_700, count: 2 });
    assert.deepEqual(s.pendingPayments, { total: 3_150, count: 1 });
    assert.deepEqual(s.verifiedInEscrow, { total: 2_100, count: 1 });
    assert.equal(s.heldRevenueETB, 300);
    assert.deepEqual(s.refunds, { total: 6_300, count: 1 });
    assert.equal(s.reversedCommissionsETB, 600);
    assert.equal(s.reversedBuyerFeesETB, 300);
    assert.equal(s.sellerPayables.releasedETB, 9_000 + 3_600);
    assert.equal(s.sellerPayables.lockedInEscrowETB, 1_800);
    assert.deepEqual(s.sellerPayables.withdrawalsRequested, { total: 5_000, count: 1 });
    assert.deepEqual(s.sellerPayables.paidOut, { total: 1_000, count: 1 });
    assert.equal(s.sellerPayables.availableETB, 12_600 - 6_000);

    const p = (await get('/revenue/payables')).body.items;
    assert.equal(p.length, 1);
    assert.deepEqual([p[0].name, p[0].lockedETB, p[0].releasedETB, p[0].requestedETB, p[0].paidETB, p[0].availableETB], ['Seller', 1_800, 12_600, 5_000, 1_000, 6_600]);
  });

  it('daily, weekly and monthly reports bucket earned revenue by completion day (Ethiopian time) and refunds by refund day', async () => {
    await sale(10_000, 'Completed One');
    await sale(4_000, 'Completed Two');
    await sale(6_000, 'Refunded', 'refund');
    const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
    const daily = (await get('/revenue/reports?period=daily')).body;
    assert.equal(daily.rows.length, 1);
    assert.deepEqual(daily.rows[0], { period: today, sales: 2, sellerCommissionsETB: 1_400, buyerFeesETB: 700, revenueETB: 2_100, refundedETB: 6_300 });
    const weekly = (await get('/revenue/reports?period=weekly')).body;
    assert.match(weekly.rows[0].period, /^\d{4}-W\d{2}$/);
    assert.equal(weekly.rows[0].revenueETB, 2_100);
    const monthly = (await get('/revenue/reports?period=monthly')).body;
    assert.equal(monthly.rows[0].period, today.slice(0, 7));
    assert.equal(monthly.rows[0].revenueETB, 2_100);
    assert.equal((await get('/revenue/reports?period=yearly')).status, 400);
  });

  it('searchable transaction history: by reference, listing, person, status, with exact per-sale amounts and rate snapshots', async () => {
    const a = await sale(10_000, 'Sheger Alpha');
    await sale(4_000, 'Beta Channel', 'held');
    await sale(3_000, 'Gamma Unpaid', 'unpaid');

    const all = (await get('/revenue/transactions')).body;
    assert.equal(all.total, 3);
    const row = all.items.find((t: { listing: string }) => t.listing === 'Sheger Alpha');
    assert.deepEqual(
      [row.priceETB, row.buyerFeeETB, row.buyerTotalETB, row.sellerCommissionETB, row.sellerNetETB, row.revenueETB, row.status, row.sellerCommissionRate, row.buyerFeeRate],
      [10_000, 500, 10_500, 1_000, 9_000, 1_500, 'COMPLETED', 0.1, 0.05],
    );

    const q = async (s: string) => (await get(`/revenue/transactions?q=${encodeURIComponent(s)}`)).body.items.map((t: { listing: string }) => t.listing);
    assert.deepEqual(await q(a.txRef), ['Sheger Alpha']);
    assert.deepEqual(await q('sheger'), ['Sheger Alpha']);
    assert.deepEqual((await q('buyer')).sort(), ['Beta Channel', 'Gamma Unpaid', 'Sheger Alpha']); // buyer's name
    assert.deepEqual(await q('nothing-matches-this'), []);
    assert.deepEqual(await q('.*'), [], 'a search is text, never a regular expression');
    assert.deepEqual(await q('^'), []);
    assert.deepEqual(await q('{"$ne":null}'), [], 'a search can not inject a query operator');
    const status = (await get('/revenue/transactions?status=PENDING_PAYMENT')).body;
    assert.deepEqual(status.items.map((t: { listing: string }) => t.listing), ['Gamma Unpaid']);
    assert.equal((await get('/revenue/transactions?status=HACKED')).status, 400);
    assert.equal((await get('/revenue/transactions?page=0')).status, 400);

    const page = (await get('/revenue/transactions?limit=2&page=2')).body;
    assert.equal(page.items.length, 1);
    assert.equal(page.total, 3);
    const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
    assert.equal((await get(`/revenue/transactions?from=${today}&to=${today}`)).body.total, 3);
    assert.equal((await get('/revenue/transactions?from=2001-01-01&to=2001-01-02')).body.total, 0);
  });

  it('CSV export: right columns and amounts, one row per sale, spreadsheet formulas neutralised, downloaded as an attachment', async () => {
    await sale(10_000, 'Normal Channel');
    await sale(5_000, '=HYPERLINK("http://evil.example","click")');
    const res = await get('/revenue/export.csv');
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-type']), /text\/csv/);
    assert.match(String(res.headers['content-disposition']), /^attachment; filename="truthmarket-transactions-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.equal(res.headers['cache-control'], 'no-store');
    const csv = String(res.body).replace(/^﻿/, '');
    const lines = csv.trim().split('\r\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^Date,Reference,Status,Listing,Platform,Buyer,Seller,Listing price \(ETB\),Buyer fee rate,Buyer fee \(ETB\),Buyer total \(ETB\),Seller commission rate,Seller commission \(ETB\),Seller net \(ETB\),Truth Market revenue earned \(ETB\)/);
    const normal = lines.find((l) => l.includes('Normal Channel'))!;
    assert.match(normal, /,10000,0\.05,500,10500,0\.1,1000,9000,1500,0,0,/);
    assert.equal(csv.includes(',=HYPERLINK'), false, 'a cell must never start with =');
    assert.ok(csv.includes(`'=HYPERLINK`), 'the formula is neutralised with a leading apostrophe');
    // Filters apply to the export too.
    const filtered = String((await get('/revenue/export.csv?q=normal')).body).trim().split('\r\n');
    assert.equal(filtered.length, 2);
  });

  it('export and search for non-admins return no data at all', async () => {
    await sale(10_000, 'Private');
    for (const who of [w.buyer, w.seller]) {
      for (const url of ['/revenue/export.csv', '/revenue/transactions', '/revenue/summary', '/revenue/reports', '/revenue/payables']) {
        const r = await call(adminRoutes, 'GET', url, { token: who.token });
        assert.equal(r.status, 403);
        assert.equal(JSON.stringify(r.body).includes('Private'), false);
      }
    }
  });
});
