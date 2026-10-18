import { Router } from 'express';
import { advanceOrder, createOrder, getOrder, listOrders, verifyReturn } from '../controllers/escrowController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);
router.get('/', listOrders);
router.post('/', createOrder);
router.get('/verify/:txRef', verifyReturn); // must stay above "/:id"
router.get('/:id', getOrder);
router.post('/:id/:action', advanceOrder);

export default router;
