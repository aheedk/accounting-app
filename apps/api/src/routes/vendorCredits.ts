import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as vc from '../services/ap/vendorCreditService.js';
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

router.get('/businesses/:businessId/vendor-credits', async (req, res, next) => {
  try {
    const q: { business_id: string; vendor_id?: string } = {
      business_id: req.tenancy!.business_id,
    };
    const vendor_id = req.query['vendor_id'];
    if (typeof vendor_id === 'string') q.vendor_id = vendor_id;
    const list = await vc.listVendorCredits(db, q);
    res.json({ vendor_credits: list });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/vendor-credits', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.vendorCreditCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      vc.createDraft(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        vendor_id: body.vendor_id,
        credit_date: body.credit_date,
        amount: body.amount,
        offset_account_id: body.offset_account_id,
        memo: body.memo ?? null,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/vendor-credits/:id/post', requireMinRole('accountant'), async (req, res, next) => {
  try { res.json(await db.transaction().execute(trx => vc.postVendorCredit(trx, ctxFromReq(req), { vendor_credit_id: req.params['id']! }))); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/vendor-credits/:id/apply', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.vendorCreditApplySchema.parse(req.body);
    await db.transaction().execute(trx => vc.applyToBill(trx, ctxFromReq(req), { vendor_credit_id: req.params['id']!, bill_id: body.bill_id, applied_amount: body.applied_amount }));
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/vendor-credits/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.vendorCreditVoidSchema.parse(req.body);
    res.json(await db.transaction().execute(trx => vc.voidVendorCredit(trx, ctxFromReq(req), { vendor_credit_id: req.params['id']!, void_reason: body.void_reason })));
  } catch (e) { next(e); }
});

export default router;
