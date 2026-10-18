import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';
import { requireAdmin, requireAuth } from '../src/middleware/auth';
import { EscrowOrder } from '../src/models/EscrowOrder';
import { User } from '../src/models/User';
import adminRoutes from '../src/routes/adminRoutes';
import escrowRoutes from '../src/routes/escrowRoutes';
import walletRoutes from '../src/routes/walletRoutes';
import webhookRoutes from '../src/routes/webhookRoutes';
import { Actors, call, db, freshWorld, makeListing, provider, signedWebhook } from './helpers';

let w: Actors;
beforeEach(async () => {
  w = await freshWorld();
  provider.reset();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stack = (adminRoutes as any).stack as { method: string | null; path: string | null; handlers: unknown[]; isUse?: boolean }[];
const routes = stack.filter((l) => !l.isUse);
const concrete = (p: string) => p; // admin routes have no path parameters

async function paidSale(price = 10_000) {
  const listingId = await makeListing(w.seller.id, price, 'Secret Channel');
  const r = await call(escrowRoutes, 'POST', '/', { token: w.buyer.token, body: { listingId } });
  const order = await EscrowOrder.findById(r.body.order._id).lean();
  provider.pay(order!.txRef);
  const { rawBody, headers } = signedWebhook(order!.txRef);
  await call(webhookRoutes, 'POST', '/chapa', { rawBody, headers });
  await call(escrowRoutes, 'POST', `/${order!._id}/markTransferred`, { token: w.seller.token });
  await call(escrowRoutes, 'POST', `/${order!._id}/confirmReceipt`, { token: w.buyer.token });
  return String(order!._id);
}

describe('the admin revenue API is protected on the server', () => {
  it('every route is behind requireAuth + requireAdmin, registered before any route', () => {
    assert.ok(routes.length >= 7, 'expected the revenue, report, transaction, export, payables and settings routes');
    assert.equal(stack[0].isUse, true, 'the guards must be the first layer');
    assert.deepEqual(stack[0].handlers, [requireAuth, requireAdmin]);
    // Nothing is registered before the guards, so no route can bypass them.
    assert.equal(stack.indexOf(routes[0]), 1);
  });

  it('no token: 401 on every admin route (including the CSV export and settings changes)', async () => {
    for (const r of routes) {
      const res = await call(adminRoutes, r.method!, concrete(r.path!));
      assert.equal(res.status, 401, `${r.method} ${r.path}`);
      assert.equal(JSON.stringify(res.body).includes('Revenue'), false);
    }
  });

  it('a BUYER cannot open any admin page or API: 403 on every route', async () => {
    await paidSale();
    for (const r of routes) {
      const res = await call(adminRoutes, r.method!, concrete(r.path!), { token: w.buyer.token, body: { sellerCommissionPct: 0, buyerFeePct: 0 } });
      assert.equal(res.status, 403, `${r.method} ${r.path}`);
      assert.deepEqual(Object.keys(res.body), ['error', 'details'].filter((k) => k in res.body), 'only an error message, no data');
    }
  });

  it('a SELLER cannot open any admin page or API: 403 on every route', async () => {
    await paidSale();
    for (const r of routes) {
      const res = await call(adminRoutes, r.method!, concrete(r.path!), { token: w.seller.token, body: { sellerCommissionPct: 0, buyerFeePct: 0 } });
      assert.equal(res.status, 403, `${r.method} ${r.path}`);
    }
  });

  it('forged, expired, tampered or unknown-user tokens are rejected (401)', async () => {
    const forged = jwt.sign({ sub: w.admin.id }, 'some-other-secret-some-other-secret-1234');
    const expired = jwt.sign({ sub: w.admin.id }, config.jwtSecret, { expiresIn: -10 });
    const ghost = jwt.sign({ sub: String(db.ObjectId ? new db.ObjectId() : '') }, config.jwtSecret);
    const tampered = w.buyer.token.slice(0, -2) + 'xx';
    // A buyer who edits the payload to claim another id still fails the signature check.
    const [h, , s] = w.buyer.token.split('.');
    const swapped = `${h}.${Buffer.from(JSON.stringify({ sub: w.admin.id, role: 'admin' })).toString('base64url')}.${s}`;
    for (const token of [forged, expired, ghost, tampered, swapped, 'garbage']) {
      for (const r of routes) assert.equal((await call(adminRoutes, r.method!, r.path!, { token })).status, 401, `${r.method} ${r.path}`);
    }
  });

  it('the role is read from the database: an admin who is demoted loses access immediately, even with a valid token', async () => {
    assert.equal((await call(adminRoutes, 'GET', '/revenue/summary', { token: w.admin.token })).status, 200);
    await User.updateOne({ _id: w.admin.id }, { $set: { role: 'user' } });
    assert.equal((await call(adminRoutes, 'GET', '/revenue/summary', { token: w.admin.token })).status, 403);
  });

  it('an administrator gets the data (200) on every GET route', async () => {
    await paidSale();
    for (const r of routes.filter((x) => x.method === 'GET')) {
      const res = await call(adminRoutes, 'GET', r.path!, { token: w.admin.token });
      assert.equal(res.status, 200, `${r.path}: ${JSON.stringify(res.body).slice(0, 200)}`);
    }
    const s = await call(adminRoutes, 'GET', '/revenue/summary', { token: w.admin.token });
    assert.equal(s.body.combinedRevenueETB, 1_500);
    assert.equal(s.headers['cache-control'], 'no-store');
  });

  it('only an administrator can change the commission rates; others change nothing', async () => {
    for (const who of [w.buyer, w.seller, undefined]) {
      const r = await call(adminRoutes, 'PUT', '/settings/commission', { token: who?.token, body: { sellerCommissionPct: 1, buyerFeePct: 1 } });
      assert.ok([401, 403].includes(r.status));
    }
    const got = await call(adminRoutes, 'GET', '/settings/commission', { token: w.admin.token });
    assert.equal(got.body.sellerCommissionRate, 0.1);
    assert.equal(got.body.buyerFeeRate, 0.05);
    assert.equal(got.body.history.length, 0);
  });

  it('rate changes are validated (negative, above 50%, wrong types are rejected)', async () => {
    for (const body of [{ sellerCommissionPct: -1, buyerFeePct: 5 }, { sellerCommissionPct: 10, buyerFeePct: 51 }, { sellerCommissionPct: '10', buyerFeePct: 5 }, { sellerCommissionPct: 10 }, {}]) {
      const r = await call(adminRoutes, 'PUT', '/settings/commission', { token: w.admin.token, body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    const ok = await call(adminRoutes, 'PUT', '/settings/commission', { token: w.admin.token, body: { sellerCommissionPct: 10, buyerFeePct: 5 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.history[0].by, w.admin.id, 'who changed it is recorded');
  });

  it('the existing admin withdrawal API is also admin only', async () => {
    for (const who of [w.buyer, w.seller]) {
      assert.equal((await call(walletRoutes, 'GET', '/admin/withdrawals', { token: who.token })).status, 403);
      assert.equal((await call(walletRoutes, 'POST', '/admin/withdrawals/abc/decision', { token: who.token, body: { decision: 'paid', text: 'x' } })).status, 403);
    }
    assert.equal((await call(walletRoutes, 'GET', '/admin/withdrawals')).status, 401);
  });

  it('structure: the revenue service is imported only by the admin controller, and the admin router is mounted once under /api/admin', () => {
    const src = join(__dirname, '..', 'src');
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name) && /from '(\.\.?\/)+(services\/)?revenueService'/.test(readFileSync(p, 'utf8'))) importers.push(e.name);
      }
    };
    walk(src);
    assert.deepEqual(importers.sort(), ['adminRevenueController.ts']);
    const server = readFileSync(join(src, 'server.ts'), 'utf8');
    assert.equal(server.match(/app\.use\([^)]*adminRoutes/g)!.length, 1, 'mounted exactly once');
    assert.ok(server.includes("app.use('/api/admin', adminRoutes)"));
  });
});

describe('sellers and buyers only see their own money, never platform totals', () => {
  it('seller dashboard: own price 10,000, commission 1,000, net 9,000, and nothing else', async () => {
    await paidSale();
    const r = await call(walletRoutes, 'GET', '/earnings', { token: w.seller.token });
    assert.equal(r.status, 200);
    const sale = r.body.sales[0];
    assert.deepEqual([sale.priceETB, sale.commissionRate, sale.commissionETB, sale.netETB, sale.payout], [10_000, 0.1, 1_000, 9_000, 'released']);
    assert.equal(r.body.totals.listingPriceETB, 10_000);
    assert.equal(r.body.totals.commissionETB, 1_000);
    assert.equal(r.body.totals.netProceedsETB, 9_000);
    assert.equal(r.body.totals.pendingPayoutETB, 9_000);
    assert.equal(r.body.totals.completedPayoutsETB, 0);
    const text = JSON.stringify(r.body);
    for (const leak of ['buyerFee', 'totalETB', 'combinedRevenue', 'trustmedia', 'grossVolume', '10500', '1500', '"500"']) assert.equal(text.includes(leak), false, `seller response must not contain ${leak}`);
  });

  it('another seller (or a buyer) sees none of it', async () => {
    await paidSale();
    for (const who of [w.other, w.buyer]) {
      const r = await call(walletRoutes, 'GET', '/earnings', { token: who.token });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.sales, []);
      assert.equal(r.body.totals.netProceedsETB, 0);
    }
    assert.equal((await call(walletRoutes, 'GET', '/earnings')).status, 401);
  });

  it('a seller cannot ask for someone else by passing an id: the id comes from the login token', async () => {
    await paidSale();
    const r = await call(walletRoutes, 'GET', `/earnings?userId=${w.seller.id}&seller=${w.seller.id}`, { token: w.other.token });
    assert.deepEqual(r.body.sales, []);
  });

  it('order views are split by role: buyer sees fee and total, seller sees commission and net, neither sees the other side', async () => {
    const id = await paidSale();
    const buyerView = (await call(escrowRoutes, 'GET', `/${id}`, { token: w.buyer.token })).body.order;
    assert.deepEqual([buyerView.priceETB, buyerView.buyerFeeETB, buyerView.totalETB], [10_000, 500, 10_500]);
    for (const k of ['commissionETB', 'commissionRate', 'sellerEscrowETB', 'sellerNetETB', 'ledgerPosted']) assert.equal(k in buyerView, false, `buyer must not see ${k}`);

    const sellerView = (await call(escrowRoutes, 'GET', `/${id}`, { token: w.seller.token })).body.order;
    assert.deepEqual([sellerView.priceETB, sellerView.commissionETB, sellerView.sellerNetETB], [10_000, 1_000, 9_000]);
    for (const k of ['buyerFeeETB', 'buyerFeeRate', 'totalETB', 'ledgerPosted']) assert.equal(k in sellerView, false, `seller must not see ${k}`);

    const adminView = (await call(escrowRoutes, 'GET', `/${id}`, { token: w.admin.token })).body.order;
    assert.deepEqual([adminView.buyerFeeETB, adminView.commissionETB, adminView.totalETB], [500, 1_000, 10_500]);

    // The order list obeys the same rules, and an unrelated user gets nothing.
    const list = (await call(escrowRoutes, 'GET', '/', { token: w.seller.token })).body.orders;
    assert.equal(list.length, 1);
    assert.equal('totalETB' in list[0], false);
    assert.deepEqual((await call(escrowRoutes, 'GET', '/', { token: w.other.token })).body.orders, []);
    assert.equal((await call(escrowRoutes, 'GET', `/${id}`, { token: w.other.token })).status, 404);
  });

  it('the buyer checkout response (before paying) already shows price, fee and total', async () => {
    const listingId = await makeListing(w.seller.id, 10_000);
    const r = await call(escrowRoutes, 'POST', '/', { token: w.buyer.token, body: { listingId } });
    const o = r.body.order;
    assert.deepEqual([o.priceETB, o.buyerFeeETB, o.totalETB, o.buyerFeeRate], [10_000, 500, 10_500, 0.05]);
    assert.equal('commissionETB' in o, false);
  });
});

describe('demo mode (no payment provider configured)', () => {
  it('is reported as demo, and starting a payment is refused instead of being simulated', async () => {
    const saved = (config.chapa as { secretKey: string }).secretKey;
    (config.chapa as { secretKey: string }).secretKey = '';
    try {
      const { paymentsMode } = await import('../src/config');
      assert.equal(paymentsMode(), 'demo');
      const listingId = await makeListing(w.seller.id, 10_000);
      const r = await call(escrowRoutes, 'POST', '/', { token: w.buyer.token, body: { listingId } });
      assert.equal(r.status, 503);
      assert.match(r.body.error, /DEMO MODE/);
      assert.equal(db.all('EscrowOrder').length, 0, 'no order is created');
      assert.equal(db.all('LedgerEntry').length, 0, 'nothing is recorded as paid');
    } finally {
      (config.chapa as { secretKey: string }).secretKey = saved;
    }
  });
});
