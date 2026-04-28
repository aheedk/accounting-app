import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as receiptSvc from '../services/inventory/itemReceiptService.js';
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

router.get('/businesses/:businessId/item-receipts', async (req, res, next) => {
  try {
    const item_receipts = await receiptSvc.listReceipts(db, req.tenancy!.business_id);
    res.json({ item_receipts });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/item-receipts', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.itemReceiptCreateSchema.parse(req.body);
    const input: receiptSvc.CreateReceiptInput = {
      business_id: req.tenancy!.business_id,
      purchase_order_id: body.purchase_order_id,
      receipt_date: body.receipt_date,
    };
    if (body.memo !== undefined) input.memo = body.memo ?? null;
    const created = await db.transaction().execute(trx =>
      receiptSvc.createReceipt(trx, ctxFromReq(req), input),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

export default router;
