import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, me, register } from '../controllers/authController';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Slows down password guessing and mass sign ups from one address.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

router.post('/register', limiter, register);
router.post('/login', limiter, login);
router.get('/me', requireAuth, me);

export default router;
