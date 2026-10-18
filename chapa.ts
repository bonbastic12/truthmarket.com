import { createHmac, timingSafeEqual } from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import { config } from '../config';
import { ApiError } from '../utils/http';

const TIMEOUT_MS = 15_000;

interface InitInput {
  amountETB: number;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  txRef: string;
  returnUrl: string;
  callbackUrl?: string;
}

async function chapaFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${config.chapa.apiBase}${path}`, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${config.chapa.secretKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

/**
 * POST /v1/transaction/initialize
 * Creates a hosted checkout for the exact ETB amount and returns the secure checkout_url.
 */
export async function initializeTransaction(i: InitInput): Promise<{ checkoutUrl: string }> {
  let res: Response;
  try {
    res = await chapaFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        amount: String(i.amountETB),
        currency: 'ETB',
        email: i.email,
        first_name: i.firstName,
        last_name: i.lastName,
        phone_number: i.phone,
        tx_ref: i.txRef,
        return_url: i.returnUrl,
        ...(i.callbackUrl ? { callback_url: i.callbackUrl } : {}),
        customization: { title: 'Truth Market', description: 'Channel purchase with escrow' },
      }),
    });
  } catch (e) {
    console.error('Chapa initialize failed to connect', e);
    throw new ApiError(502, 'The payment provider is not reachable right now. Please try again in a moment.');
  }

  const data = (await res.json().catch(() => ({}))) as { status?: string; message?: unknown; data?: { checkout_url?: string } };
  const url = data.data?.checkout_url;
  if (!res.ok || data.status !== 'success' || !url) {
    console.error('Chapa initialize rejected', res.status, JSON.stringify(data).slice(0, 500));
    throw new ApiError(502, 'The payment provider could not start the payment. Please try again.');
  }
  return { checkoutUrl: url };
}

export interface VerifiedPayment {
  paid: boolean;
  amount: number;
  currency: string;
  txRef: string;
  reference?: string;
  method?: string;
}

/**
 * GET /v1/transaction/verify/:tx_ref
 * The source of truth for "was this paid". Money is never trusted from a webhook body alone.
 * Returns null when Chapa has no such transaction (nothing was paid), and throws when Chapa cannot be reached
 * so the caller can retry later instead of wrongly treating the order as unpaid.
 */
export async function verifyTransaction(txRef: string): Promise<VerifiedPayment | null> {
  let res: Response;
  try {
    res = await chapaFetch(`/transaction/verify/${encodeURIComponent(txRef)}`);
  } catch (e) {
    console.error('Chapa verify failed to connect', e);
    throw new ApiError(502, 'Could not reach the payment provider to confirm the payment');
  }
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) {
    console.error('Chapa verify error', res.status);
    throw new ApiError(502, 'The payment provider could not confirm the payment');
  }
  const body = (await res.json().catch(() => ({}))) as {
    status?: string;
    data?: { status?: string; amount?: string | number; currency?: string; tx_ref?: string; reference?: string; method?: string };
  };
  const d = body.data;
  if (!d) return null;
  return {
    paid: body.status === 'success' && d.status === 'success',
    amount: Number(d.amount),
    currency: String(d.currency ?? ''),
    txRef: String(d.tx_ref ?? txRef),
    reference: d.reference ? String(d.reference) : undefined,
    method: d.method ? String(d.method) : undefined,
  };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Chapa signs webhooks with HMAC-SHA256 (key = your webhook secret) and sends the hex digest in the
 * `x-chapa-signature` / `Chapa-Signature` headers.
 *
 * Chapa's documentation hashes `JSON.stringify(req.body)` but does not say whether that equals the exact bytes
 * it sent, so two digests are accepted: one over the raw bytes, one over the compact re-serialised JSON.
 * A forged request still needs the secret to produce either. Even a valid signature only triggers
 * settlePayment, which asks Chapa's verify API before any money state changes.
 */
export function verifyWebhookSignature(rawBody: Buffer, headers: IncomingHttpHeaders, secret: string = config.chapa.webhookSecret): boolean {
  if (!secret) return false;
  const digests = [createHmac('sha256', secret).update(rawBody).digest('hex')];
  try {
    const compact = JSON.stringify(JSON.parse(rawBody.toString('utf8')));
    digests.push(createHmac('sha256', secret).update(compact).digest('hex'));
  } catch {
    /* not JSON: only the raw digest can match, and the handler rejects the body afterwards */
  }
  return ['x-chapa-signature', 'chapa-signature']
    .map((h) => headers[h])
    .some((v) => typeof v === 'string' && v.length > 0 && digests.some((d) => safeEqual(v.trim().toLowerCase(), d)));
}
