import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as assets from '../services/assets/fixedAssetService.js';
import * as depreciation from '../services/assets/depreciationService.js';
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

router.get('/businesses/:businessId/fixed-assets', async (req, res, next) => {
  try {
    const list = await assets.listFixedAssets(db, req.tenancy!.business_id);
    res.json({ fixed_assets: list });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/fixed-assets/:id', async (req, res, next) => {
  try {
    res.json(await assets.getFixedAsset(db, req.tenancy!.business_id, req.params['id']!));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/fixed-assets', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.fixedAssetCreateSchema.parse(req.body);
    const input: assets.CreateFixedAssetInput = {
      business_id: req.tenancy!.business_id,
      name: body.name,
      asset_account_id: body.asset_account_id,
      depreciation_expense_account_id: body.depreciation_expense_account_id,
      accumulated_depreciation_account_id: body.accumulated_depreciation_account_id,
      purchase_date: body.purchase_date,
      cost: body.cost,
      salvage_value: body.salvage_value ?? '0',
      useful_life_years: body.useful_life_years,
      memo: body.memo ?? null,
    };
    const created = await db.transaction().execute(trx =>
      assets.createFixedAsset(trx, ctxFromReq(req), input),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/fixed-assets/:id', requireMinRole('staff'), async (req, res, next) => {
  try {
    const parsed = schemas.fixedAssetUpdateSchema.parse(req.body);
    const patch: assets.UpdateFixedAssetInput['patch'] = {};
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.memo !== undefined) patch.memo = parsed.memo ?? null;
    const updated = await db.transaction().execute(trx =>
      assets.updateFixedAsset(trx, ctxFromReq(req), { fixed_asset_id: req.params['id']!, patch }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/fixed-assets/:id/depreciate', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.depreciationRunSchema.parse(req.body);
    const entry = await db.transaction().execute(trx =>
      depreciation.runDepreciation(trx, ctxFromReq(req), {
        fixed_asset_id: req.params['id']!,
        period_end: body.period_end,
      }),
    );
    res.json(entry);
  } catch (e) { next(e); }
});

export default router;
