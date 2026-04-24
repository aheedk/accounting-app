import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import type { PurchaseOrderStatus } from '../db/types.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as poSvc from '../services/inventory/purchaseOrderService.js';
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

const PO_STATUSES: ReadonlySet<PurchaseOrderStatus> = new Set([
  'draft', 'sent', 'received', 'closed', 'void',
]);

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/purchase-orders', async (req, res, next) => {
  try {
    const opts: { status?: PurchaseOrderStatus } = {};
    const status = req.query['status'];
    if (typeof status === 'string' && PO_STATUSES.has(status as PurchaseOrderStatus)) {
      opts.status = status as PurchaseOrderStatus;
    }
    const purchase_orders = await poSvc.listPOs(db, req.tenancy!.business_id, opts);
    res.json({ purchase_orders });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/purchase-orders/:id', async (req, res, next) => {
  try {
    res.json(await poSvc.getPO(db, req.tenancy!.business_id, req.params['id']!));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/purchase-orders', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.purchaseOrderCreateSchema.parse(req.body);
    const input: poSvc.CreatePOInput = {
      business_id: req.tenancy!.business_id,
      vendor_id: body.vendor_id,
      order_date: body.order_date,
      lines: body.lines.map(l => {
        const line: poSvc.CreatePOLineInput = {
          inventory_item_id: l.inventory_item_id,
          quantity: l.quantity,
          unit_cost: l.unit_cost,
        };
        if (l.description !== undefined) line.description = l.description ?? null;
        return line;
      }),
    };
    if (body.expected_delivery_date !== undefined) {
      input.expected_delivery_date = body.expected_delivery_date ?? null;
    }
    if (body.memo !== undefined) input.memo = body.memo ?? null;
    const created = await db.transaction().execute(trx =>
      poSvc.createPO(trx, ctxFromReq(req), input),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/purchase-orders/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const updated = await db.transaction().execute(trx =>
      poSvc.voidPO(trx, ctxFromReq(req), { po_id: req.params['id']! }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
