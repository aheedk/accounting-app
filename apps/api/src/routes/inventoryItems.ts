import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as itemSvc from '../services/inventory/inventoryItemService.js';
import * as stockSvc from '../services/inventory/stockMovementService.js';
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

router.get('/businesses/:businessId/inventory-items', async (req, res, next) => {
  try {
    const include_inactive = req.query['include_inactive'] === 'true';
    const items = await itemSvc.listItems(db, req.tenancy!.business_id, { include_inactive });
    res.json({ items });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/inventory-items/:id', async (req, res, next) => {
  try {
    res.json(await itemSvc.getItem(db, req.tenancy!.business_id, req.params['id']!));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/inventory-items', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.inventoryItemCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      itemSvc.createItem(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        sku: body.sku,
        name: body.name,
        description: body.description ?? null,
        unit_of_measure: body.unit_of_measure ?? 'each',
        purchase_cost: body.purchase_cost ?? null,
        sale_price: body.sale_price ?? null,
        income_account_id: body.income_account_id ?? null,
        expense_account_id: body.expense_account_id ?? null,
        inventory_asset_account_id: body.inventory_asset_account_id ?? null,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/inventory-items/:id', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.inventoryItemUpdateSchema.parse(req.body);
    const patch: itemSvc.InventoryItemPatch = {};
    if (body.sku !== undefined) patch.sku = body.sku;
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description ?? null;
    if (body.unit_of_measure !== undefined) patch.unit_of_measure = body.unit_of_measure;
    if (body.purchase_cost !== undefined) patch.purchase_cost = body.purchase_cost ?? null;
    if (body.sale_price !== undefined) patch.sale_price = body.sale_price ?? null;
    if (body.income_account_id !== undefined) patch.income_account_id = body.income_account_id ?? null;
    if (body.expense_account_id !== undefined) patch.expense_account_id = body.expense_account_id ?? null;
    if (body.inventory_asset_account_id !== undefined) patch.inventory_asset_account_id = body.inventory_asset_account_id ?? null;
    if (body.is_active !== undefined) patch.is_active = body.is_active;

    const updated = await db.transaction().execute(trx =>
      itemSvc.updateItem(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        item_id: req.params['id']!,
        patch,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/inventory-items/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx =>
      itemSvc.deleteItem(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        item_id: req.params['id']!,
      }),
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/inventory-items/:id/adjust-stock', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.stockAdjustSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      stockSvc.adjustStock(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        item_id: req.params['id']!,
        movement_date: body.movement_date,
        quantity_delta: body.quantity_delta,
        reason: body.reason,
        memo: body.memo ?? null,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

export default router;
