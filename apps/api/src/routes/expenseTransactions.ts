import { Router, type Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as et from '../services/ap/expenseTransactionService.js';
import * as auditService from '../services/audit/auditService.js';
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

router.get('/businesses/:businessId/expense-transactions', async (req, res, next) => {
  try {
    res.json({ expense_transactions: await et.listExpenses(db, ctxFromReq(req)) });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/expense-transactions/:id', async (req, res, next) => {
  try { res.json(await et.getExpense(db, ctxFromReq(req), req.params['id']!)); }
  catch (e) { next(e); }
});

router.get('/businesses/:businessId/expense-transactions/:id/audit-history', async (req, res, next) => {
  try {
    const history = await auditService.listByEntity(
      db, req.tenancy!.business_id, 'expense_transaction', req.params['id']!,
    );
    res.json({ history });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/expense-transactions', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.expenseTransactionCreateSchema.parse(req.body) as et.CreateExpenseInput;
    const ctx = ctxFromReq(req);
    const created = await db.transaction().execute(trx => et.createExpense(trx, ctx, body));
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/expense-transactions/:id', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.expenseTransactionUpdateSchema.parse(req.body) as et.CreateExpenseInput;
    const ctx = ctxFromReq(req);
    const updated = await db.transaction().execute(trx => et.updateExpense(trx, ctx, req.params['id']!, body));
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/expense-transactions/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const updated = await db.transaction().execute(trx =>
      et.voidExpense(trx, ctxFromReq(req), { expense_transaction_id: req.params['id']! }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/expense-transactions/:id', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx => et.deleteExpense(trx, ctxFromReq(req), req.params['id']!));
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
