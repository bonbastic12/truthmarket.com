import { Router } from 'express';
import { exportCsv, getCommissionSettings, payables, putCommissionSettings, reports, summary, transactions } from '../controllers/adminRevenueController';
import { requireAdmin, requireAuth } from '../middleware/auth';

const router = Router();

/**
 * Private administrator API. The two guards come FIRST and apply to every route registered below them, so a route added
 * later cannot be left open by accident: no token -> 401, a buyer or seller token -> 403. The role is read from the database
 * on every request (see middleware/auth.ts), so a demoted admin loses access immediately.
 */
router.use(requireAuth, requireAdmin);

router.get('/revenue/summary', summary);
router.get('/revenue/reports', reports);
router.get('/revenue/transactions', transactions);
router.get('/revenue/export.csv', exportCsv);
router.get('/revenue/payables', payables);
router.get('/settings/commission', getCommissionSettings);
router.put('/settings/commission', putCommissionSettings);

export default router;
