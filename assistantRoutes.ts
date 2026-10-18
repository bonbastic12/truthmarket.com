import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { chat } from '../controllers/assistantController';
import { optionalAuth } from '../middleware/auth';

const router = Router();

// Each answer costs money, so it is limited per user (or per visitor address when logged out).
router.post(
  '/',
  optionalAuth,
  rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anonymous',
    message: { error: 'Too many questions. Please try again in a few minutes.' },
  }),
  chat,
);

export default router;
