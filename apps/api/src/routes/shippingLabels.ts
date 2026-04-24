import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as labelSvc from '../services/inventory/shippingLabelService.js';
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

router.get('/businesses/:businessId/shipping-labels', async (req, res, next) => {
  try {
    const opts: { invoice_id?: string; sales_order_id?: string } = {};
    const invoice_id = req.query['invoice_id'];
    const sales_order_id = req.query['sales_order_id'];
    if (typeof invoice_id === 'string') opts.invoice_id = invoice_id;
    if (typeof sales_order_id === 'string') opts.sales_order_id = sales_order_id;
    const labels = await labelSvc.listLabels(db, req.tenancy!.business_id, opts);
    res.json({ labels });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/shipping-labels', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.shippingLabelCreateSchema.parse(req.body);
    const input: labelSvc.CreateLabelInput = {
      business_id: req.tenancy!.business_id,
      carrier: body.carrier,
      tracking_number: body.tracking_number,
      shipped_at: body.shipped_at,
    };
    if (body.invoice_id !== undefined) input.invoice_id = body.invoice_id ?? null;
    if (body.sales_order_id !== undefined) input.sales_order_id = body.sales_order_id ?? null;
    if (body.cost !== undefined) input.cost = body.cost ?? null;
    if (body.label_file_id !== undefined) input.label_file_id = body.label_file_id ?? null;
    if (body.notes !== undefined) input.notes = body.notes ?? null;
    const created = await db.transaction().execute(trx =>
      labelSvc.createLabel(trx, ctxFromReq(req), input),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/shipping-labels/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx =>
      labelSvc.deleteLabel(trx, ctxFromReq(req), { label_id: req.params['id']! }),
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
