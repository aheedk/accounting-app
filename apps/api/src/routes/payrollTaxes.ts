import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as taxSvc from '../services/payroll/payrollTaxService.js';
import type { PayrollTaxStatus } from '../db/types.js';
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

router.get('/businesses/:businessId/payroll-tax-liabilities', async (req, res, next) => {
  try {
    const statusQ = req.query['status'];
    const opts: { status?: PayrollTaxStatus } = {};
    if (statusQ === 'accrued' || statusQ === 'paid') opts.status = statusQ;
    const liabilities = await taxSvc.listLiabilities(db, req.tenancy!.business_id, opts);
    res.json({ liabilities });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/payroll-tax-liabilities', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.payrollTaxRecordSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      taxSvc.recordLiability(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        period: body.period,
        period_start: body.period_start,
        period_end: body.period_end,
        liability_account_id: body.liability_account_id,
        amount: body.amount,
        notes: body.notes ?? null,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/payroll-tax-liabilities/:id/pay', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.payrollTaxPaySchema.parse(req.body);
    const updated = await db.transaction().execute(trx =>
      taxSvc.payLiability(trx, ctxFromReq(req), {
        liability_id: req.params['id']!,
        cash_account_id: body.cash_account_id,
        payment_date: body.payment_date,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
