import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as cust from '../services/ar/customerService.js';
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

router.use(requireAuth, resolveBusiness);

router.get('/businesses/:businessId/customers', async (req, res, next) => {
  try { res.json({ customers: await cust.listCustomers(db, req.tenancy!.business_id) }); }
  catch (e) { next(e); }
});

router.get('/businesses/:businessId/customers/:id', async (req, res, next) => {
  try { res.json(await cust.getCustomer(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/customers', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.customerCreateSchema.parse(req.body);
    const input: cust.CreateCustomerInput = {
      business_id: req.tenancy!.business_id,
      name: body.name,
      email: body.email ?? null,
      phone: body.phone ?? null,
      billing_address: body.billing_address ?? null,
    };
    if (body.default_terms_days !== undefined) input.default_terms_days = body.default_terms_days;
    const created = await db.transaction().execute(trx =>
      cust.createCustomer(trx, ctxFromReq(req), input),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/customers/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const parsed = schemas.customerUpdateSchema.parse(req.body);
    const patch: Partial<cust.CreateCustomerInput> = {};
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.email !== undefined) patch.email = parsed.email ?? null;
    if (parsed.phone !== undefined) patch.phone = parsed.phone ?? null;
    if (parsed.billing_address !== undefined) patch.billing_address = parsed.billing_address ?? null;
    if (parsed.default_terms_days !== undefined) patch.default_terms_days = parsed.default_terms_days;
    const updated = await db.transaction().execute(trx =>
      cust.updateCustomer(trx, ctxFromReq(req), { customer_id: req.params['id']!, patch }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/customers/:id', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx => cust.deleteCustomer(trx, ctxFromReq(req), { customer_id: req.params['id']! }));
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
