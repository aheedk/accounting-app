import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as vend from '../services/ap/vendorService.js';
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

router.get('/businesses/:businessId/vendors', async (req, res, next) => {
  try { res.json({ vendors: await vend.listVendors(db, req.tenancy!.business_id) }); }
  catch (e) { next(e); }
});

router.get('/businesses/:businessId/vendors/:id', async (req, res, next) => {
  try { res.json(await vend.getVendor(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/vendors', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.vendorCreateSchema.parse(req.body);
    const input: Parameters<typeof vend.createVendor>[2] = {
      business_id: req.tenancy!.business_id,
      name: body.name,
      email: body.email ?? null,
    };
    if (body.phone !== undefined) input.phone = body.phone ?? null;
    if (body.is_1099 !== undefined) input.is_1099 = body.is_1099;
    if (body.tax_id !== undefined) input.tax_id = body.tax_id ?? null;
    if (body.default_terms_days !== undefined) input.default_terms_days = body.default_terms_days;
    const created = await db.transaction().execute(trx =>
      vend.createVendor(trx, ctxFromReq(req), input),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/vendors/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const parsed = schemas.vendorUpdateSchema.parse(req.body);
    const patch: Partial<vend.CreateVendorInput> = {};
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.email !== undefined) patch.email = parsed.email ?? null;
    if (parsed.phone !== undefined) patch.phone = parsed.phone ?? null;
    if (parsed.is_1099 !== undefined) patch.is_1099 = parsed.is_1099;
    if (parsed.tax_id !== undefined) patch.tax_id = parsed.tax_id ?? null;
    if (parsed.default_terms_days !== undefined) patch.default_terms_days = parsed.default_terms_days;
    const updated = await db.transaction().execute(trx =>
      vend.updateVendor(trx, ctxFromReq(req), { vendor_id: req.params['id']!, patch }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/vendors/:id', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx => vend.deleteVendor(trx, ctxFromReq(req), { vendor_id: req.params['id']! }));
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
