import { Router } from 'express';
import {
  createListing, deleteListing, getListing, getListings, getStats, updateListingStatus,
} from '../controllers/listingController';
import { optionalAuth, requireAdmin, requireAuth } from '../middleware/auth';
import { requireKyc } from '../middleware/kycMiddleware';

const router = Router();

router.get('/', optionalAuth, getListings);
router.get('/stats', requireAuth, requireAdmin, getStats); // must stay above "/:id"
router.get('/:id', optionalAuth, getListing);
// Selling needs a completed National ID + phone check.
router.post('/', requireAuth, requireKyc, createListing);
router.patch('/:id/status', requireAuth, requireAdmin, updateListingStatus);
router.delete('/:id', requireAuth, requireAdmin, deleteListing);

export default router;
