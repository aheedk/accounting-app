import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as pay from '../services/ap/billPaymentService.js';
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

router.get('/businesses/:businessId/bill-payments', async (req, res, next) => {
  try {
    const q: { business_id: string; vendor_id?: string; status?: string } = {
      business_id: req.tenancy!.business_id,
    };
    const vendor_id = req.query['vendor_id'];
    if (typeof vendor_id === 'string') q.vendor_id = vendor_id;
    const status = req.query['status'];
    if (typeof status === 'string') q.status = status;
    const list = await pay.listBillPayments(db, q);
    res.json({ bill_payments: list });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/bill-payments/:id', async (req, res, next) => {
  try { res.json(await pay.getBillPaymentWithApplications(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/bill-payments', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.billPaymentDraftCreateSchema.parse(req.body);
    const input: pay.CreateDraftBillPaymentInput = {
      business_id: req.tenancy!.business_id,
      vendor_id: body.vendor_id,
      payment_date: body.payment_date,
      payment_method: body.payment_method,
      reference: body.reference ?? null,
      amount: body.amount,
      cash_account_id: body.cash_account_id,
      memo: body.memo ?? null,
    };
    if (body.initial_applications !== undefined) input.initial_applications = body.initial_applications;
    const created = await db.transaction().execute(trx => pay.createDraft(trx, ctxFromReq(req), input));
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bill-payments/:id/post', requireMinRole('accountant'), async (req, res, next) => {
  try { res.json(await db.transaction().execute(trx => pay.postBillPayment(trx, ctxFromReq(req), { bill_payment_id: req.params['id']! }))); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/bill-payments/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.billPaymentVoidSchema.parse(req.body);
    res.json(await db.transaction().execute(trx => pay.voidBillPayment(trx, ctxFromReq(req), { bill_payment_id: req.params['id']!, void_reason: body.void_reason })));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bill-payments/:id/applications', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.billPaymentApplicationSchema.parse(req.body);
    res.json(await db.transaction().execute(trx => pay.addApplication(trx, ctxFromReq(req), { bill_payment_id: req.params['id']!, bill_id: body.bill_id, applied_amount: body.applied_amount })));
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/bill-payments/:id/applications/:appId', requireMinRole('accountant'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx => pay.removeApplication(trx, ctxFromReq(req), { bill_payment_id: req.params['id']!, application_id: req.params['appId']! }));
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
