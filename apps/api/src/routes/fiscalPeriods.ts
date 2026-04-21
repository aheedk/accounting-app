import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as periods from '../services/core/fiscalPeriodService.js';
import type { ServiceCtx } from '../lib/ctx.js';

const router = Router({ mergeParams: true });

function ctxFromReq(req: Request): ServiceCtx {
  return {
    user_id: req.auth!.user_id, firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id, effective_role: req.tenancy!.effective_role,
    request_id: req.request_id, ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/periods', async (req, res, next) => {
  try {
    const list = await periods.listPeriods(db, req.tenancy!.business_id);
    res.json({ periods: list });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/periods/seed-year', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const body = schemas.seedYearSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      periods.seedCalendarYear(trx, ctxFromReq(req), { business_id: req.tenancy!.business_id, year: body.year }),
    );
    res.status(201).json({ periods: created });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/periods/:periodId/close', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const updated = await db.transaction().execute(trx =>
      periods.closePeriod(trx, ctxFromReq(req), { period_id: req.params['periodId']! }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/periods/:periodId/reopen', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const updated = await db.transaction().execute(trx =>
      periods.reopenPeriod(trx, ctxFromReq(req), { period_id: req.params['periodId']! }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
