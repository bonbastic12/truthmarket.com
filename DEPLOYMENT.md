# Truth Market: deployment guide

This project is **not deployed anywhere yet**. This file describes how to deploy it safely. Nothing here has been run against a real host.

## 1. What the project is made of (from the code)

| Part | Technology | Folder |
|---|---|---|
| Web app | React 19, Vite 6, Tailwind 4, React Router 7 (static files after build) | `client/` |
| API | Node 20+, Express 4, TypeScript (compiled with `tsc` to `dist/`) | `server/` |
| Database | **MongoDB** through Mongoose 8 (no SQL database is used) | `server/src/models/` |
| Payments | Chapa (hosted checkout, verify API, signed webhook) | `server/src/services/chapa.ts` |
| SMS | Afro Message (verification codes) | `server/src/services/sms.ts` |
| AI Assistant | Anthropic API, called **from the server only** | `server/src/controllers/assistantController.ts` |
| File storage | Encrypted National ID photos on a **disk** (`KYC_STORAGE_DIR`) | `server/src/services/kycCrypto.ts` |

## 2. Recommended hosting

- **API + web app: Render** (`render.yaml` in this folder is a ready Blueprint): one Node web service for `server/` and one static site for `client/`.
  The API needs a **paid** instance because the encrypted ID photos need a persistent disk, which the free plan does not have.
- **Database: MongoDB Atlas** (managed MongoDB). Start with a dedicated cluster with backups, not the free shared tier, because it will hold identity data.
- Any host that runs a long-lived Node process, offers a persistent disk and serves static files works too (Railway, Fly.io, a VPS with nginx).
  Serverless/ephemeral hosts are **not** suitable for the API: the background escrow sweeper and the ID-photo disk need a long-lived server.

## 3. Database setup (MongoDB)

1. Create an Atlas cluster, a database user for the app (read/write on the `truthmarket` database only) and add the API host's outgoing IPs (or use Atlas private networking). Avoid `0.0.0.0/0` for a production database.
2. Put the connection string in `MONGODB_URI`, with the database name at the end: `mongodb+srv://USER:PASSWORD@cluster.xxxx.mongodb.net/truthmarket?retryWrites=true&w=majority`.
3. There are **no migrations**. On every start the API creates any missing indexes (`createIndexes`: add-only, it never drops or changes data). The unique indexes matter for money safety (one ledger row per order and type, one order per `tx_ref`, one account per National ID fingerprint).
4. Create the first admin once, from your own computer or the host shell, with `NODE_ENV=production`, `SEED_ADMIN_EMAIL`, a `SEED_ADMIN_PASSWORD` of 12+ characters, then `npm run seed` in `server/`. In production the seed creates **only the admin**; it creates no demo sellers or listings. Without `NODE_ENV=production` it also inserts demo data, so never run it that way against the real database.
5. Turn on Atlas backups and test one restore before launch.

## 4. Environment variables

Real values go only in the host's dashboard, never in git, never in the client. Full documented list: `server/.env.example` and `client/.env.example`.

**Server (required)**: `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET` (48+ random bytes), `CLIENT_ORIGIN`, `CLIENT_URL`, `PUBLIC_API_URL` (all three `https://`), `TRUST_PROXY=1`,
`CHAPA_SECRET_KEY`, `CHAPA_WEBHOOK_SECRET`, `KYC_ENCRYPTION_KEY`, `KYC_HASH_KEY`, `KYC_STORAGE_DIR` (on the persistent disk), `SMS_PROVIDER=afromessage` with `AFROMESSAGE_TOKEN`, `AFROMESSAGE_IDENTIFIER_ID`, `AFROMESSAGE_SENDER_NAME`.
**Server (optional)**: `COMMISSION_RATE` / `BUYER_FEE_RATE` (defaults `0.10` / `0.05`; they only **seed** the first value in the database. After that the rates live in the database and only an administrator changes them on the Commission & Revenue page), `INSPECTION_HOURS`, `MIN_WITHDRAWAL_ETB`, `USD_TO_ETB`, `ANTHROPIC_API_KEY` + `ASSISTANT_MODEL` (empty key = assistant off), `ENABLE_LIVE_PAYMENTS`.
**Client (build time)**: `VITE_API_URL=https://<api-host>/api`. This is the only variable the browser sees; it contains no secret.

The API refuses to start in production if: an address is not `https://`, `MONGODB_URI` points to localhost, `SMS_PROVIDER=console`, the KYC keys are missing or weak, or a **live** Chapa key is used without `ENABLE_LIVE_PAYMENTS=true`.

## 5. Deploy steps (Render + Atlas)

1. Push this folder to a private Git repository. Run `npm install` once in `server/` and in `client/` on your computer, fix anything `npm run build` reports, and commit the two `package-lock.json` files.
2. Atlas: create the cluster and user (section 3).
3. Render: **New > Blueprint**, pick the repository. Fill in the secrets Render asks for. Generate the keys with the commands in `server/.env.example`; **back up `KYC_ENCRYPTION_KEY`** somewhere safe (losing it makes every stored ID unreadable).
4. After the first deploy, set `CLIENT_ORIGIN`/`CLIENT_URL` to the web app's `https` address, `PUBLIC_API_URL` to the API's address, `VITE_API_URL` to `<API address>/api`, and redeploy the web app (Vite reads it at build time).
5. Check `https://<api>/api/health` returns `{"ok":true,"db":true}`, and `https://<api>/api/config` shows `"paymentsMode":"test"`.
6. Run the admin seed (section 3, step 4).
7. Chapa dashboard (**test mode**): set the webhook URL to `https://<api>/api/webhook/chapa` and the same secret as `CHAPA_WEBHOOK_SECRET`.
8. Custom domain: add it in Render for both services, then update the three address variables and `VITE_API_URL`.

## 6. Payments: test first, then live

- While the key starts with `CHASECK_TEST-`, no real money moves, the site shows a **TEST MODE** banner, and the API reports `paymentsMode: test`.
- An order becomes `FUNDS_HELD_IN_ESCROW` **only** inside the server, after Chapa's verify API confirms the transaction and the exact ETB amount (webhook, Chapa callback, buyer return page and a background sweeper all use the same function). No frontend request and no admin button can mark an order as paid.
- **Commission system.** Seller commission 10% (taken from the seller's proceeds) and buyer fee 5% (added on top of the price) are stored in the database (`PlatformSettings`), changed only through `PUT /api/admin/settings/commission` (admin only, every change kept in a history), and **copied onto each order when it is created**, so changing them never alters an existing sale. Example, listing 10,000 ETB: buyer pays 10,500 (Chapa is asked for exactly that and the order is only accepted if Chapa confirms exactly that amount), seller receives 9,000, Truth Market revenue 1,500 (1,000 + 500). All arithmetic is in `server/src/services/money.ts` (whole birr).
- **Small-sale buyer fee.** Listings priced under 1,000 ETB carry a flat 100 ETB buyer fee instead of 5% (150 ETB listing: buyer pays 250; seller still receives 90% of 150). From 1,000 ETB up the 5% applies. The rule lives in `server/src/services/money.ts` (mirrored in `client/src/lib/money.ts`); each order stores `buyerFeeFlat` so reports label it correctly.
- **Ledger.** Separate append-only rows per order, unique per (order, type) so a repeated webhook cannot double-count: `listing_price`, `payment_received`, `platform_commission` (seller commission), `buyer_fee`, `seller_escrow`, `seller_release`, `trustmedia_revenue`, `buyer_refund`, `commission_reversal`, `fee_reversal`; withdrawals and payouts are in `PayoutEntry`. Commission and fee are *held* (`pending`) while the money is in escrow and become *earned* (and `trustmedia_revenue` is written) only when the sale completes. Each state change plus its ledger rows is one database transaction (MongoDB Atlas / replica set; on a lone local `mongod`, which cannot run transactions, the same code runs without one and relies on the atomic status change, the unique index and the sweeper repair). A refund returns price + fee to the buyer and reverses both commission rows; a completed sale cannot be refunded through the escrow flow.
- **Private admin API** (`requireAuth` + `requireAdmin` on every route, role re-read from the database on each request): `GET /api/admin/revenue/summary | reports?period=daily|weekly|monthly | transactions?q=&status=&from=&to=&page= | export.csv | payables`, `GET/PUT /api/admin/settings/commission`. Page: `/admin/revenue`. Sellers see only their own sales at `GET /api/wallet/earnings`.
- **Demo mode.** With no `CHAPA_SECRET_KEY` the API reports `paymentsMode: demo` (red banner), refuses to start a payment (HTTP 503) and nothing is ever simulated as paid. In production the API will not start without the key.
- Payouts to sellers are **not automated**: sellers request a withdrawal and a person pays it from the bank/Telebirr and records the reference. Refunds are sent from the Chapa dashboard and then recorded by an admin.

**Before setting `ENABLE_LIVE_PAYMENTS=true`**, complete these in test mode and keep the evidence: buy with a test account and see the order reach escrow through the webhook; replay the same webhook (no double ledger); send a webhook with a wrong signature (must get 401); pay a different amount (must become `REFUND_REQUIRED`); let an unpaid order expire; open a dispute and refund; confirm Chapa's real signature header name and signing method against your Chapa account (the code accepts the documented `x-chapa-signature` / `Chapa-Signature` headers, HMAC-SHA256); then switch to the live key and run one small real purchase yourself.

## 7. National ID (Fayda) verification: what exists and what does not

- **Exists:** sellers upload an ID photo and enter name, ID number (16-digit format check) and the phone linked to the ID; the account phone must equal that phone; an SMS code proves they control it; an **admin looks at the photo and approves or rejects**. Data is encrypted at rest (AES-256-GCM), the ID number is fingerprinted to block one ID on two accounts, every admin view is logged.
- **Does NOT exist:** there is **no connection to the official Fayda / National ID Program (NIDP) system**. The software cannot tell whether an ID is genuine or whether the phone is really linked to it; both are what the seller declares plus a human check. Do not describe it to users as "verified by Fayda".
- **To add the official check** you need to apply to the National ID Program for API access and credentials (the e-KYC / authentication service), and sign their data-protection terms. Until you hold those credentials, keep the manual review and describe it honestly. When you have them, add the call inside `submitKyc` in `server/src/services/kycService.ts`, and keep the admin review as a fallback.
- Also needed: a lawyer's review of the privacy policy and of how long ID data is kept under Ethiopian data-protection law.

## 8. Security notes

- Permissions are enforced on the server: listing creation and the wallet need the completed ID check; admin routes check the role in the database on every request; an order can only be read by its buyer, its seller or an admin; the buyer, the seller and the admin each have a separate list of allowed steps.
- Rate limits: login/registration, ID/SMS codes, withdrawals, the webhook and the assistant. Set `TRUST_PROXY=1` behind Render/nginx or they count the proxy instead of visitors.
- The AI key exists only in the API's environment. The assistant cannot read accounts or orders and is told never to ask for passwords or codes.
- Run `npm audit` in both folders and update dependencies before launch.
