import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import * as ledger from '../services/core/ledgerService.js';

const router = Router({ mergeParams: true });
router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/reports/trial-balance', async (req, res, next) => {
  try {
    const q = schemas.trialBalanceQuerySchema.parse({ as_of: req.query['as_of'] ?? new Date().toISOString().slice(0, 10) });
    const out = await ledger.computeTrialBalance(db, { business_id: req.tenancy!.business_id, as_of: q.as_of });
    res.json({ as_of: q.as_of, ...out });
  } catch (e) { next(e); }
});

export default router;
