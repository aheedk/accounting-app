import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as budgetSvc from '../services/reports/budgetService.js';
import type { ServiceCtx } from '../lib/ctx.js';
import type { BudgetStatus } from '../db/types.js';

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

router.get('/businesses/:businessId/budgets', async (req, res, next) => {
  try {
    const budgets = await budgetSvc.listBudgets(db, req.tenancy!.business_id);
    res.json({ budgets });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/budgets/:id', async (req, res, next) => {
  try {
    res.json(await budgetSvc.getBudgetWithLines(db, req.tenancy!.business_id, req.params['id']!));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/budgets', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.budgetCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      budgetSvc.createBudget(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        name: body.name,
        fiscal_year: body.fiscal_year,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/budgets/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.budgetUpdateSchema.parse(req.body);
    const patch: { name?: string; status?: BudgetStatus } = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.status !== undefined) patch.status = body.status;
    const updated = await db.transaction().execute(trx =>
      budgetSvc.updateBudget(trx, ctxFromReq(req), {
        budget_id: req.params['id']!,
        patch,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/budgets/:id', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx =>
      budgetSvc.deleteBudget(trx, ctxFromReq(req), { budget_id: req.params['id']! }),
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/budgets/:id/lines', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.setBudgetLineSchema.parse(req.body);
    const line = await db.transaction().execute(trx =>
      budgetSvc.setBudgetLine(trx, ctxFromReq(req), {
        budget_id: req.params['id']!,
        account_id: body.account_id,
        month_offset: body.month_offset,
        amount: body.amount,
      }),
    );
    res.json(line);
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/budgets/:id/variance', async (req, res, next) => {
  try {
    const rows = await budgetSvc.getVarianceReport(db, req.tenancy!.business_id, req.params['id']!);
    res.json({ rows });
  } catch (e) { next(e); }
});

export default router;
