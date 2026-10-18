import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

function rate(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!(n >= 0 && n <= 0.5)) throw new Error(`${name} must be a number between 0 and 0.5 (0.10 = 10%)`);
  return n;
}

function positive(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!(n > 0 && n < 100000)) throw new Error(`${name} must be a positive number`);
  return n;
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters long');

const clientOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 5000),
  isProd: process.env.NODE_ENV === 'production',
  /** Number of reverse proxies in front of the API (Render, Railway, nginx = 1). Without it every visitor looks like the proxy's IP and shares one rate limit. */
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  mongoUri: required('MONGODB_URI'),
  jwtSecret,
  clientOrigins,
  /** Where Chapa sends the buyer after paying (the React app). */
  clientUrl: (process.env.CLIENT_URL ?? clientOrigins[0] ?? 'http://localhost:5173').replace(/\/$/, ''),
  /** Public address of THIS API, used for Chapa's callback_url. Must be reachable from the internet (use ngrok in development). */
  publicApiUrl: (process.env.PUBLIC_API_URL ?? '').replace(/\/$/, ''),

  /** First-time default for the seller commission (0.10 = 10%). The live value is stored in the database and edited by an admin; this only seeds it. */
  commissionRate: rate('COMMISSION_RATE', 0.1),
  /** First-time default for the buyer fee ADDED on top of the price (0.05 = 5%). The live value is stored in the database and edited by an admin. */
  buyerFeeRate: rate('BUYER_FEE_RATE', 0.05),
  /** The buyer's inspection window that starts when the seller reports the handover. */
  inspectionMs: Number(process.env.INSPECTION_HOURS ?? 48) * 60 * 60 * 1000,
  /** Used to turn a website's USD revenue into ETB (sorting and price guidance). Set it to today's rate. */
  usdToEtb: positive('USD_TO_ETB', 140),
  /** How long an unpaid order keeps the listing reserved. */
  pendingTtlMs: Number(process.env.PENDING_PAYMENT_MINUTES ?? 30) * 60 * 1000,

  kyc: {
    /** AES-256 key (32 random bytes, base64) that encrypts National ID photos and numbers at rest. */
    encryptionKey: Buffer.from(process.env.KYC_ENCRYPTION_KEY ?? '', 'base64'),
    /** Separate secret for the ID-number fingerprint and the OTP hashes. */
    hashKey: process.env.KYC_HASH_KEY ?? '',
    /** Where the encrypted ID photos are kept. Must not be a public or static folder. */
    storageDir: process.env.KYC_STORAGE_DIR ?? './storage/kyc',
    /** Fayda FIN is 16 digits. Change it if you accept other ID formats. */
    idNumberPattern: new RegExp(process.env.KYC_ID_PATTERN ?? '^\\d{16}$'),
    otpTtlMs: 5 * 60 * 1000,
    otpMaxAttempts: 5,
    otpResendMs: 60 * 1000,
    otpMaxSendsPerHour: 5,
    imageMinBytes: 20 * 1024,
    imageMaxBytes: 6 * 1024 * 1024,
  },
  sms: {
    /** 'afromessage' sends real SMS. 'console' prints the code in the server log (development only). */
    provider: process.env.SMS_PROVIDER ?? 'console',
    afroToken: process.env.AFROMESSAGE_TOKEN ?? '',
    afroIdentifier: process.env.AFROMESSAGE_IDENTIFIER_ID ?? '',
    afroSender: process.env.AFROMESSAGE_SENDER_NAME ?? '',
  },

  payout: {
    /** Smallest withdrawal in whole ETB. */
    minETB: positive('MIN_WITHDRAWAL_ETB', 100),
    otpTtlMs: 5 * 60 * 1000,
    otpMaxAttempts: 5,
    otpResendMs: 60 * 1000,
  },

  /** Real-money switch. Stays false until you have completed Chapa test-mode checks (see DEPLOYMENT.md, section "Going live"). */
  liveGate: {
    enabled: process.env.ENABLE_LIVE_PAYMENTS === 'true',
  },

  /** Truth Market AI Assistant. The key stays on the server; the browser only talks to /api/assistant. Empty key = assistant switched off. */
  assistant: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ASSISTANT_MODEL ?? 'claude-haiku-5-5',
    maxOutputTokens: 600,
  },

  chapa: {
    apiBase: process.env.CHAPA_API_BASE ?? 'https://api.chapa.co/v1',
    secretKey: process.env.CHAPA_SECRET_KEY ?? '',
    webhookSecret: process.env.CHAPA_WEBHOOK_SECRET ?? '',
  },
} as const;

export const isChapaTestKey = () => /TEST/i.test(config.chapa.secretKey);
/**
 * 'demo': no payment provider is configured, so NO payment can be started (nothing is simulated as paid).
 * 'test': a Chapa test key, no real money moves. 'live': real money.
 * Shown to the browser so a demo or test deployment is never mistaken for a real one.
 */
export const paymentsMode = (): 'demo' | 'test' | 'live' => (!config.chapa.secretKey ? 'demo' : isChapaTestKey() ? 'test' : 'live');

/** Called when the API starts, so a missing payment key fails loudly instead of at the first purchase. */
export function assertPaymentConfig(): void {
  if (!config.chapa.secretKey) {
    // A real deployment must never start without a payment provider. Locally the site starts in labelled DEMO mode: browsing works,
    // checkout shows the price, fee and total, but no payment can be created or marked as paid.
    if (config.isProd) throw new Error('Missing CHAPA_SECRET_KEY (Chapa dashboard > Settings > API)');
    console.warn('DEMO MODE: CHAPA_SECRET_KEY is not set. Payments are disabled; nothing will be charged or simulated as paid.');
    return;
  }
  if (!config.chapa.webhookSecret) throw new Error('Missing CHAPA_WEBHOOK_SECRET (the secret you set for the webhook in the Chapa dashboard)');
  // Chapa test keys contain "TEST" (CHASECK_TEST-...). Any other key can move real money, so it needs an explicit, separate opt-in.
  if (!isChapaTestKey() && !config.liveGate.enabled) {
    throw new Error('CHAPA_SECRET_KEY looks like a LIVE key but ENABLE_LIVE_PAYMENTS is not "true". Use a CHASECK_TEST- key until payments are tested, then set ENABLE_LIVE_PAYMENTS=true on purpose.');
  }
  if (isChapaTestKey() && config.liveGate.enabled) {
    console.warn('ENABLE_LIVE_PAYMENTS=true but the Chapa key is a TEST key: payments stay in test mode.');
  }
  if (config.isProd && !config.publicApiUrl) {
    console.warn('PUBLIC_API_URL is not set: Chapa callback_url will be skipped. The webhook configured in the Chapa dashboard still works.');
  }
}

/** Called when the API starts: identity data must never be stored with a missing or weak key. */
export function assertKycConfig(): void {
  if (config.kyc.encryptionKey.length !== 32) {
    throw new Error('KYC_ENCRYPTION_KEY must be 32 random bytes in base64. Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  }
  if (config.kyc.hashKey.length < 32) throw new Error('KYC_HASH_KEY must be at least 32 characters. Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  if (config.sms.provider !== 'console' && config.sms.provider !== 'afromessage') throw new Error("SMS_PROVIDER must be 'afromessage' or 'console'");
  if (config.sms.provider === 'afromessage' && !config.sms.afroToken) throw new Error('Missing AFROMESSAGE_TOKEN');
  if (config.isProd && config.sms.provider === 'console') throw new Error("SMS_PROVIDER=console prints OTP codes in the log and is not allowed in production");
}

/** Production-only checks for settings that default to development values. */
export function assertProductionConfig(): void {
  if (!config.isProd) return;
  const problems: string[] = [];
  if (!process.env.CLIENT_ORIGIN) problems.push('CLIENT_ORIGIN (the public address of the React app, used for CORS)');
  if (!process.env.CLIENT_URL) problems.push('CLIENT_URL (where Chapa sends buyers back to)');
  if (!config.publicApiUrl) problems.push('PUBLIC_API_URL (needed for Chapa callbacks)');
  if (/localhost|127\.0\.0\.1/.test(config.mongoUri)) problems.push('MONGODB_URI points to localhost; use a managed MongoDB such as Atlas');
  for (const [name, url] of [['CLIENT_URL', config.clientUrl], ['PUBLIC_API_URL', config.publicApiUrl]] as const) {
    if (url && !url.startsWith('https://')) problems.push(`${name} must start with https://`);
  }
  if (config.clientOrigins.some((o) => !o.startsWith('https://'))) problems.push('every CLIENT_ORIGIN entry must start with https://');
  if (config.sms.provider === 'console') problems.push("SMS_PROVIDER must not be 'console' (it prints verification codes in the log)");
  if (config.trustProxy < 1) console.warn('TRUST_PROXY is 0: behind a hosting proxy all visitors will share one rate limit. Set TRUST_PROXY=1.');
  if (problems.length) throw new Error('Production configuration is incomplete:\n - ' + problems.join('\n - '));
}
