import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as bill from '../services/ap/billService.js';
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

router.get('/businesses/:businessId/bills', async (req, res, next) => {
  try {
    const q: { business_id: string; status?: string; vendor_id?: string } = {
      business_id: req.tenancy!.business_id,
    };
    const status = req.query['status'];
    if (typeof status === 'string') q.status = status;
    const vendor_id = req.query['vendor_id'];
    if (typeof vendor_id === 'string') q.vendor_id = vendor_id;
    const list = await bill.listBills(db, q);
    res.json({ bills: list });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/bills/:id', async (req, res, next) => {
  try { res.json(await bill.getBillWithLines(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/bills', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.billDraftCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      bill.createDraft(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        vendor_id: body.vendor_id,
        bill_number: body.bill_number,
        bill_date: body.bill_date,
        due_date: body.due_date,
        memo: body.memo ?? null,
        terms: body.terms ?? null,
        lines: body.lines,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bills/:id/post', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const posted = await db.transaction().execute(trx => bill.postBill(trx, ctxFromReq(req), { bill_id: req.params['id']! }));
    res.json(posted);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bills/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.billVoidSchema.parse(req.body);
    const voided = await db.transaction().execute(trx => bill.voidBill(trx, ctxFromReq(req), { bill_id: req.params['id']!, void_reason: body.void_reason }));
    res.json(voided);
  } catch (e) { next(e); }
});

export default router;
