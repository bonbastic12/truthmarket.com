import { Request, Response } from 'express';
import { verifyWebhookSignature } from '../services/chapa';
import { settlePayment } from '../services/escrowService';

interface ChapaEvent {
  event?: string;
  type?: string;
  status?: string;
  tx_ref?: string;
  trx_ref?: string;
  reference?: string;
}

/**
 * POST /api/webhook/chapa
 * Mounted with express.raw (see webhookRoutes), so req.body is the untouched Buffer the signature is computed over.
 *
 *  1. Reject anything whose HMAC-SHA256 signature does not match (401).
 *  2. On charge.success, settle the order. settlePayment asks Chapa's verify API to confirm the payment and the
 *     amount, then atomically moves PENDING_PAYMENT -> FUNDS_HELD_IN_ESCROW and posts the 10% / 90% ledger split.
 *     No admin approval is involved.
 *  3. Answer 200 for everything we understood (including duplicates and unknown orders) so Chapa stops retrying;
 *     answer 500 only when Chapa could not be reached, so Chapa retries the delivery later.
 */
export async function chapaWebhook(req: Request, res: Response) {
  const raw = req.body;
  if (!Buffer.isBuffer(raw) || raw.length === 0) return res.status(400).json({ error: 'Empty body' });
  if (!verifyWebhookSignature(raw, req.headers)) return res.status(401).json({ error: 'Invalid signature' });

  let payload: ChapaEvent;
  try {
    payload = JSON.parse(raw.toString('utf8')) as ChapaEvent;
  } catch {
    return res.status(400).json({ error: 'Malformed JSON' });
  }

  const txRef = String(payload.tx_ref ?? payload.trx_ref ?? '').slice(0, 60);
  const kind = payload.event ?? payload.type ?? '';
  const isSuccess = kind === 'charge.success' || (!kind && payload.status === 'success');

  if (!txRef) return res.status(200).json({ received: true, ignored: 'no tx_ref' });
  if (!isSuccess) return res.status(200).json({ received: true, ignored: kind || 'not a success event' });

  try {
    const order = await settlePayment(txRef, 'webhook');
    return res.status(200).json({ received: true, status: order?.status ?? 'unknown_order' });
  } catch (e) {
    console.error('Webhook settle failed, asking Chapa to retry', (e as Error).message);
    return res.status(500).json({ error: 'Temporary error, please retry' });
  }
}

/**
 * GET /api/webhook/chapa/callback?trx_ref=...
 * Chapa's callback_url. It carries no secret, so it only triggers the same verified settlement
 * (Chapa is asked directly) and never trusts the query string.
 */
export async function chapaCallback(req: Request, res: Response) {
  const txRef = String(req.query.trx_ref ?? req.query.tx_ref ?? '').slice(0, 60);
  if (!txRef) return res.status(200).send('ok');
  try {
    await settlePayment(txRef, 'webhook');
    res.status(200).send('ok');
  } catch (e) {
    console.error('Callback settle failed', (e as Error).message);
    res.status(500).send('retry');
  }
}
