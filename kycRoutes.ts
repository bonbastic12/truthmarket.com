import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  adminDecision, adminDetail, adminImage, adminQueue, checkCode, getStatus, sendCode, submit,
} from '../controllers/kycController';
import { requireAdmin, requireAuth } from '../middleware/auth';

const router = Router();

// The ID photo arrives as a data URL, so this router has its own, larger JSON limit. It is mounted before the global parser.
router.use(express.json({ limit: '9mb' }));

const perUser = (windowMs: number, max: number, message: string) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? 'anonymous',
    message: { error: message },
  });

router.get('/status', requireAuth, getStatus);
router.post('/submit', requireAuth, perUser(60 * 60 * 1000, 6, 'Too many submissions. Try again later.'), submit);
router.post('/otp/send', requireAuth, perUser(60 * 60 * 1000, 12, 'Too many code requests. Try again later.'), sendCode);
router.post('/otp/verify', requireAuth, perUser(15 * 60 * 1000, 20, 'Too many attempts. Try again later.'), checkCode);

// Admin review: the queue, one submission with decrypted details, the photo, and the decision.
router.get('/admin/queue', requireAuth, requireAdmin, adminQueue);
router.get('/admin/:userId', requireAuth, requireAdmin, adminDetail);
router.get('/admin/:userId/image', requireAuth, requireAdmin, adminImage);
router.post('/admin/:userId/decision', requireAuth, requireAdmin, adminDecision);

export default router;
