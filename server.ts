import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { assertKycConfig, assertPaymentConfig, assertProductionConfig, config, paymentsMode } from './config';
import { errorHandler, notFound } from './middleware/errorHandler';
import adminRoutes from './routes/adminRoutes';
import assistantRoutes from './routes/assistantRoutes';
import authRoutes from './routes/authRoutes';
import escrowRoutes from './routes/escrowRoutes';
import kycRoutes from './routes/kycRoutes';
import listingRoutes from './routes/listingRoutes';
import walletRoutes from './routes/walletRoutes';
import webhookRoutes from './routes/webhookRoutes';
import { startSweeper } from './services/escrowService';
import { getRates } from './services/settings';
import { SMALL_SALE_FLAT_FEE_ETB, SMALL_SALE_THRESHOLD_ETB } from './services/money';

const app = express();

app.disable('x-powered-by');
if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);
app.use(helmet());

// Chapa calls the webhook server-to-server (no browser, no CORS) and needs the RAW body for signature checking,
// so it is mounted BEFORE the JSON parser.
app.use('/api/webhook', webhookRoutes);

app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin tools (no Origin header) and the configured browser origins.
      if (!origin || config.clientOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
// Identity routes carry the ID photo and parse their own (larger) body, so they sit before the small global limit.
app.use('/api/kyc', kycRoutes);
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: mongoose.connection.readyState === 1 });
});
// Money rules for the browser, so the screens always show the same numbers the server uses.
app.get('/api/config', async (_req, res, next) => {
  try {
    // The rates come from the database (an admin can change them). These are RATES only, never any totals.
    const rates = await getRates();
    res.json({ commissionRate: rates.sellerCommissionRate, buyerFeeRate: rates.buyerFeeRate, smallSaleThresholdETB: SMALL_SALE_THRESHOLD_ETB, smallSaleFlatFeeETB: SMALL_SALE_FLAT_FEE_ETB, inspectionHours: config.inspectionMs / 3_600_000, usdToEtb: config.usdToEtb, paymentsMode: paymentsMode() });
  } catch (e) {
    next(e);
  }
});
app.use('/api/auth', authRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes); // every route here is behind requireAuth + requireAdmin

app.use(notFound);
app.use(errorHandler);

async function main() {
  assertProductionConfig();
  assertPaymentConfig();
  assertKycConfig();
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri);
  // Create any index declared in the models that is missing. createIndexes only ADDS indexes; syncIndexes would also
  // drop indexes that are not in the code, which is not safe on a database that already holds real data.
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
  await getRates(); // creates the commission settings document (10% / 5%) the first time
  const server = app.listen(config.port, () => {
    console.log(`Truth Market API listening on :${config.port} (payments: ${paymentsMode()})`);
  });
  startSweeper();

  const shutdown = async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});

export default app;
