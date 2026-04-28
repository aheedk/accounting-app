import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import * as rpt from '../services/ap/reports/tenNinetyNineReportService.js';

const router = Router({ mergeParams: true });
router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/reports/1099', async (req, res, next) => {
  try {
    const q = schemas.tenNinetyNineQuerySchema.parse({ year: req.query['year'] ?? new Date().getFullYear() });
    const rows = await rpt.tenNinetyNine(db, { business_id: req.tenancy!.business_id, year: q.year });
    res.json({ year: q.year, rows });
  } catch (e) { next(e); }
});

export default router;
