import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import * as aging from '../services/ar/reports/agingReportService.js';
import * as apAging from '../services/ap/reports/apAgingReportService.js';
import { customerStatement } from '../services/ar/reports/customerStatementService.js';

const router = Router({ mergeParams: true });
router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/reports/aging', async (req, res, next) => {
  try {
    const q = schemas.agingQuerySchema.parse({ as_of: req.query['as_of'] ?? new Date().toISOString().slice(0, 10) });
    const rows = await aging.customerAging(db, { business_id: req.tenancy!.business_id, as_of: q.as_of });
    res.json({ as_of: q.as_of, rows });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/reports/ap-aging', async (req, res, next) => {
  try {
    const q = schemas.agingQuerySchema.parse({ as_of: req.query['as_of'] ?? new Date().toISOString().slice(0, 10) });
    const rows = await apAging.vendorAging(db, { business_id: req.tenancy!.business_id, as_of: q.as_of });
    res.json({ as_of: q.as_of, rows });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/reports/customer-statement', async (req, res, next) => {
  try {
    const q = schemas.customerStatementQuerySchema.parse(req.query);
    res.json(await customerStatement(db, { business_id: req.tenancy!.business_id, ...q }));
  } catch (e) { next(e); }
});

export default router;
