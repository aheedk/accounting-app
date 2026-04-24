import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as bizSvc from '../services/core/businessService.js';
import type { BusinessPatch } from '../services/core/businessService.js';
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

router.get('/businesses/:businessId', async (req, res, next) => {
  try {
    const biz = await bizSvc.getBusiness(db, req.tenancy!.business_id);
    res.json(biz);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const body = schemas.businessUpdateSchema.parse(req.body);
    const patch: BusinessPatch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.legal_name !== undefined) patch.legal_name = body.legal_name ?? null;
    if (body.tax_id !== undefined) patch.tax_id = body.tax_id ?? null;
    if (body.fiscal_year_start_month !== undefined) patch.fiscal_year_start_month = body.fiscal_year_start_month;
    if (body.address !== undefined) patch.address = body.address ?? null;

    const updated = await db.transaction().execute(trx =>
      bizSvc.updateBusiness(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        patch,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
