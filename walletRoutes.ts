import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { adminDecide, adminList, earnings, sendCode, wallet, withdraw } from '../controllers/walletController';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { requireKyc } from '../middleware/kycMiddleware';

const router = Router();

const perUser = (windowMs: number, max: number, message: string) =>
  rateLimit({ windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => req.user?.id ?? 'anonymous', message: { error: message } });

router.use(requireAuth);

// Looking at the balance is allowed for everyone. Moving money needs the National ID + phone check (requireKyc).
router.get('/', wallet);
router.get('/earnings', earnings);
router.post('/withdraw/code', requireKyc, perUser(60 * 60 * 1000, 6, 'Too many codes requested. Try again in an hour.'), sendCode);
router.post('/withdraw', requireKyc, perUser(15 * 60 * 1000, 10, 'Too many attempts. Try again later.'), withdraw);

router.get('/admin/withdrawals', requireAdmin, adminList);
router.post('/admin/withdrawals/:id/decision', requireAdmin, adminDecide);

export default router;
