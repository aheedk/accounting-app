import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as soSvc from '../services/inventory/salesOrderService.js';
import type { SalesOrderStatus } from '../db/types.js';
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

const SO_STATUSES: ReadonlyArray<SalesOrderStatus> = ['draft', 'confirmed', 'fulfilled', 'void'];
function parseStatus(v: unknown): SalesOrderStatus | undefined {
  if (typeof v !== 'string') return undefined;
  return (SO_STATUSES as ReadonlyArray<string>).includes(v) ? (v as SalesOrderStatus) : undefined;
}

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/sales-orders', async (req, res, next) => {
  try {
    const status = parseStatus(req.query['status']);
    const opts: { status?: SalesOrderStatus } = {};
    if (status) opts.status = status;
    const sales_orders = await soSvc.listSOs(db, req.tenancy!.business_id, opts);
    res.json({ sales_orders });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/sales-orders/:id', async (req, res, next) => {
  try {
    res.json(await soSvc.getSO(db, req.tenancy!.business_id, req.params['id']!));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/sales-orders', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.salesOrderCreateSchema.parse(req.body);
    const input: soSvc.CreateSOInput = {
      business_id: req.tenancy!.business_id,
      customer_id: body.customer_id,
      order_date: body.order_date,
      memo: body.memo ?? null,
      lines: body.lines.map(l => ({
        inventory_item_id: l.inventory_item_id,
        description: l.description ?? null,
        quantity: l.quantity,
        unit_price: l.unit_price,
      })),
    };
    const created = await db.transaction().execute(trx =>
      soSvc.createSO(trx, ctxFromReq(req), input),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/sales-orders/:id/fulfill', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const updated = await db.transaction().execute(trx =>
      soSvc.fulfill(trx, ctxFromReq(req), { so_id: req.params['id']! }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/sales-orders/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const updated = await db.transaction().execute(trx =>
      soSvc.voidSO(trx, ctxFromReq(req), { so_id: req.params['id']! }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
