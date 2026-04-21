import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as cm from '../services/ar/creditMemoService.js';
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
router.use(requireAuth, resolveBusiness);

router.get('/businesses/:businessId/credit-memos', async (req, res, next) => {
  try {
    const q: { business_id: string; customer_id?: string } = {
      business_id: req.tenancy!.business_id,
    };
    const customer_id = req.query['customer_id'];
    if (typeof customer_id === 'string') q.customer_id = customer_id;
    const list = await cm.listCreditMemos(db, q);
    res.json({ credit_memos: list });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/credit-memos', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.creditMemoCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      cm.createDraft(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        customer_id: body.customer_id,
        memo_date: body.memo_date,
        amount: body.amount,
        revenue_account_id: body.revenue_account_id,
        memo: body.memo ?? null,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/credit-memos/:id/post', requireMinRole('accountant'), async (req, res, next) => {
  try { res.json(await db.transaction().execute(trx => cm.postCreditMemo(trx, ctxFromReq(req), { credit_memo_id: req.params['id']! }))); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/credit-memos/:id/apply', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.creditMemoApplySchema.parse(req.body);
    await db.transaction().execute(trx => cm.applyToInvoice(trx, ctxFromReq(req), { credit_memo_id: req.params['id']!, invoice_id: body.invoice_id, applied_amount: body.applied_amount }));
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/credit-memos/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.creditMemoVoidSchema.parse(req.body);
    res.json(await db.transaction().execute(trx => cm.voidCreditMemo(trx, ctxFromReq(req), { credit_memo_id: req.params['id']!, void_reason: body.void_reason })));
  } catch (e) { next(e); }
});

export default router;
