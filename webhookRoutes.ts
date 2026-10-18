import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { chapaCallback, chapaWebhook } from '../controllers/webhookController';

const router = Router();

// Generous (Chapa retries and bursts are normal) but stops a flood of unsigned requests from costing a verify call each.
router.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests' } }));

// The body is kept as raw bytes: Chapa's signature is computed over the exact bytes it sent,
// and re-serialising parsed JSON would change them.
router.post('/chapa', express.raw({ type: () => true, limit: '200kb' }), chapaWebhook);
router.get('/chapa/callback', chapaCallback);

export default router;
