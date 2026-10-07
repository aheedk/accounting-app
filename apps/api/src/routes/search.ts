import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { searchRecords } from '../services/core/searchService.js';

const router = Router({ mergeParams: true });
router.use('/businesses/:businessId', requireAuth, resolveBusiness);

// The top-bar search: customers, vendors, invoices and bills of the open company.
router.get('/businesses/:businessId/search', async (req, res, next) => {
  try {
    const query = typeof req.query['q'] === 'string' ? req.query['q'].slice(0, 100) : '';
    res.json({ results: await searchRecords(db, { business_id: req.tenancy!.business_id, query }) });
  } catch (e) { next(e); }
});

export default router;
