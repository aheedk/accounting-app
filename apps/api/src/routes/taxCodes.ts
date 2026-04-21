import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as tax from '../services/tax/taxCodeService.js';
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

router.get('/businesses/:businessId/tax-codes', async (req, res, next) => {
  try { res.json({ tax_codes: await tax.listTaxCodes(db, req.tenancy!.business_id) }); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/tax-codes', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const body = schemas.taxCodeCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      tax.createTaxCode(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        code: body.code,
        name: body.name,
        tax_payable_account_id: body.tax_payable_account_id,
        initial_rate: {
          rate: body.initial_rate.rate,
          effective_from: body.initial_rate.effective_from,
          effective_to: body.initial_rate.effective_to ?? null,
        },
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

export default router;
