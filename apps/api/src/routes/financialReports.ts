import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import * as pnl from '../services/reports/profitLossService.js';
import * as bs from '../services/reports/balanceSheetService.js';
import * as cf from '../services/reports/cashFlowService.js';

const router = Router({ mergeParams: true });
router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/reports/pnl', async (req: Request, res, next) => {
  try {
    const q = schemas.pnlQuerySchema.parse({
      period_start: req.query['period_start'],
      period_end: req.query['period_end'],
    });
    const report = await pnl.profitLoss(db, {
      business_id: req.tenancy!.business_id,
      period_start: q.period_start,
      period_end: q.period_end,
    });
    res.json(report);
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/reports/balance-sheet', async (req: Request, res, next) => {
  try {
    const q = schemas.balanceSheetQuerySchema.parse({
      as_of: req.query['as_of'] ?? new Date().toISOString().slice(0, 10),
    });
    const report = await bs.balanceSheet(db, {
      business_id: req.tenancy!.business_id,
      as_of: q.as_of,
    });
    res.json(report);
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/reports/cash-flow', async (req: Request, res, next) => {
  try {
    const q = schemas.cashFlowQuerySchema.parse({
      period_start: req.query['period_start'],
      period_end: req.query['period_end'],
      ...(typeof req.query['cash_account_id'] === 'string' ? { cash_account_id: req.query['cash_account_id'] } : {}),
    });
    const report = await cf.cashFlow(db, {
      business_id: req.tenancy!.business_id,
      period_start: q.period_start,
      period_end: q.period_end,
      ...(q.cash_account_id !== undefined ? { cash_account_id: q.cash_account_id } : {}),
    });
    res.json(report);
  } catch (e) { next(e); }
});

export default router;
