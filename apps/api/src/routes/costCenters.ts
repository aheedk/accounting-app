import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as ccSvc from '../services/core/costCenterService.js';
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

router.get('/businesses/:businessId/cost-centers', async (req, res, next) => {
  try {
    const include_inactive = req.query['include_inactive'] === 'true';
    const cost_centers = await ccSvc.listCostCenters(db, req.tenancy!.business_id, { include_inactive });
    res.json({ cost_centers });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/cost-centers/:id', async (req, res, next) => {
  try {
    res.json(await ccSvc.getCostCenter(db, req.tenancy!.business_id, req.params['id']!));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/cost-centers', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.costCenterCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      ccSvc.createCostCenter(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        name: body.name,
        code: body.code ?? null,
        is_active: body.is_active ?? true,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/cost-centers/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.costCenterUpdateSchema.parse(req.body);
    const patch: { name?: string; code?: string | null; is_active?: boolean } = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.code !== undefined) patch.code = body.code ?? null;
    if (body.is_active !== undefined) patch.is_active = body.is_active;

    const updated = await db.transaction().execute(trx =>
      ccSvc.updateCostCenter(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        cost_center_id: req.params['id']!,
        patch,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/cost-centers/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx =>
      ccSvc.deleteCostCenter(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        cost_center_id: req.params['id']!,
      }),
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
