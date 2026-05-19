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

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/customers', async (req, res, next) => {
  try { res.json({ customers: await cust.listCustomers(db, req.tenancy!.business_id) }); }
  catch (e) { next(e); }
});

router.get('/businesses/:businessId/customers/:id', async (req, res, next) => {
  try { res.json(await cust.getCustomer(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

type CustomerBodyKey = Exclude<keyof cust.CreateCustomerInput, 'business_id'>;
const PASSTHROUGH_KEYS = [
  'name', 'company_name', 'title', 'first_name', 'middle_name', 'last_name', 'suffix',
  'email', 'email_cc', 'email_bcc',
  'phone', 'mobile', 'fax', 'other_phone',
  'website', 'name_on_checks',
  'billing_address', 'shipping_address', 'shipping_same_as_billing',
  'notes',
  'primary_payment_method', 'sales_form_delivery', 'invoice_language', 'credit_limit',
  'customer_type', 'tax_exemption_details',
  'opening_balance', 'opening_balance_as_of',
  'default_terms_days',
] as const satisfies readonly CustomerBodyKey[];

function buildPatch(parsed: Record<string, unknown>): Partial<cust.CreateCustomerInput> {
  const patch: Record<string, unknown> = {};
  for (const k of PASSTHROUGH_KEYS) {
    if (parsed[k] !== undefined) patch[k] = parsed[k];
  }
  return patch as Partial<cust.CreateCustomerInput>;
}

router.post('/businesses/:businessId/customers', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.customerCreateSchema.parse(req.body);
    const input: cust.CreateCustomerInput = {
      business_id: req.tenancy!.business_id,
      name: body.name,
      ...buildPatch(body as unknown as Record<string, unknown>),
    };
    const created = await db.transaction().execute(trx =>
      cust.createCustomer(trx, ctxFromReq(req), input),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/customers/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const parsed = schemas.customerUpdateSchema.parse(req.body);
    const patch = buildPatch(parsed as unknown as Record<string, unknown>);
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
