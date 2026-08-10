import { Router, type Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as et from '../services/ap/expenseTransactionService.js';
import type { ServiceCtx } from '../lib/ctx.js';
import type { PaymentMethod } from '../db/types.js';

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
    const status = req.query['status'];
    const paymentMethod = schemas.paymentMethodSchema.safeParse(req.query['payment_method']);
    const opts: {
      status?: 'draft' | 'posted' | 'void';
      payment_method?: PaymentMethod;
    } = {};
    if (status === 'draft' || status === 'posted' || status === 'void') opts.status = status;
    if (paymentMethod.success) opts.payment_method = paymentMethod.data;
    res.json({ expense_transactions: await et.listExpenses(db, req.tenancy!.business_id, opts) });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/expense-transactions/:id', async (req, res, next) => {
  try { res.json(await et.getExpense(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/expense-transactions', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.expenseTransactionCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      et.createDraft(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        transaction_date: body.transaction_date,
        payee_text: body.payee_text ?? null,
        vendor_id: body.vendor_id ?? null,
        expense_account_id: body.expense_account_id,
        payment_account_id: body.payment_account_id,
        payment_method: body.payment_method,
        amount: body.amount,
        memo: body.memo ?? null,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/expense-transactions/:id/post', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const updated = await db.transaction().execute(trx =>
      et.post(trx, ctxFromReq(req), { expense_transaction_id: req.params['id']! }),
    );
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

export default router;
