import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as emp from '../services/payroll/employeeService.js';
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

router.get('/businesses/:businessId/employees', async (req, res, next) => {
  try { res.json({ employees: await emp.listEmployees(db, req.tenancy!.business_id) }); }
  catch (e) { next(e); }
});

router.get('/businesses/:businessId/employees/:id', async (req, res, next) => {
  try { res.json(await emp.getEmployee(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/employees', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const body = schemas.employeeCreateSchema.parse(req.body);
    const input: Parameters<typeof emp.createEmployee>[2] = {
      business_id: req.tenancy!.business_id,
      full_name: body.full_name,
      hire_date: body.hire_date,
    };
    if (body.email !== undefined) input.email = body.email ?? null;
    if (body.phone !== undefined) input.phone = body.phone ?? null;
    if (body.address !== undefined) input.address = body.address ?? null;
    if (body.ssn !== undefined) input.ssn = body.ssn ?? null;
    if (body.termination_date !== undefined) input.termination_date = body.termination_date ?? null;
    if (body.default_pay_rate_cents !== undefined) input.default_pay_rate_cents = body.default_pay_rate_cents;
    if (body.default_pay_frequency !== undefined) input.default_pay_frequency = body.default_pay_frequency;
    if (body.w4_filing_status !== undefined) input.w4_filing_status = body.w4_filing_status ?? null;
    const created = await db.transaction().execute(trx =>
      emp.createEmployee(trx, ctxFromReq(req), input),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/employees/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const parsed = schemas.employeeUpdateSchema.parse(req.body);
    const patch: Partial<emp.CreateEmployeeInput> & { is_active?: boolean } = {};
    if (parsed.full_name !== undefined) patch.full_name = parsed.full_name;
    if (parsed.email !== undefined) patch.email = parsed.email ?? null;
    if (parsed.phone !== undefined) patch.phone = parsed.phone ?? null;
    if (parsed.address !== undefined) patch.address = parsed.address ?? null;
    if (parsed.ssn !== undefined) patch.ssn = parsed.ssn ?? null;
    if (parsed.termination_date !== undefined) patch.termination_date = parsed.termination_date ?? null;
    if (parsed.default_pay_rate_cents !== undefined) patch.default_pay_rate_cents = parsed.default_pay_rate_cents;
    if (parsed.default_pay_frequency !== undefined) patch.default_pay_frequency = parsed.default_pay_frequency;
    if (parsed.w4_filing_status !== undefined) patch.w4_filing_status = parsed.w4_filing_status ?? null;
    if (parsed.is_active !== undefined) patch.is_active = parsed.is_active;
    const updated = await db.transaction().execute(trx =>
      emp.updateEmployee(trx, ctxFromReq(req), { employee_id: req.params['id']!, patch }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/employees/:id', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx =>
      emp.deleteEmployee(trx, ctxFromReq(req), { employee_id: req.params['id']! }),
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/employees/:id/ssn-reveal', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const ssn = await emp.revealSSN(db, ctxFromReq(req), req.params['id']!);
    res.json({ ssn });
  } catch (e) { next(e); }
});

export default router;
