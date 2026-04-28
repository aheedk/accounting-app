import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as payRunSvc from '../services/payroll/payRunService.js';
import type { ServiceCtx } from '../lib/ctx.js';
import type { PayRunStatus } from '../db/types.js';

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

const payRunStatusSchema = z.enum(['draft', 'finalized', 'void']);
const payRunVoidSchema = z.object({ void_reason: z.string().min(1).max(500).optional() });

router.get('/businesses/:businessId/pay-runs', async (req, res, next) => {
  try {
    const opts: { status?: PayRunStatus } = {};
    const status = req.query['status'];
    if (typeof status === 'string') {
      opts.status = payRunStatusSchema.parse(status);
    }
    const runs = await payRunSvc.listPayRuns(db, req.tenancy!.business_id, opts);
    res.json({ pay_runs: runs });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/pay-runs/:id', async (req, res, next) => {
  try {
    res.json(await payRunSvc.getPayRunWithLines(db, req.tenancy!.business_id, req.params['id']!));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/pay-runs', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.payRunCreateSchema.parse(req.body);
    const input: payRunSvc.CreatePayRunInput = {
      business_id: req.tenancy!.business_id,
      pay_period_start: body.pay_period_start,
      pay_period_end: body.pay_period_end,
      pay_date: body.pay_date,
      memo: body.memo ?? null,
      accounts: {
        wages_expense: body.accounts.wages_expense,
        payroll_tax_expense: body.accounts.payroll_tax_expense,
        cash: body.accounts.cash,
        fed_tax_liability: body.accounts.fed_tax_liability,
        fica_liability: body.accounts.fica_liability,
        ...(body.accounts.state_tax_liability !== undefined
          ? { state_tax_liability: body.accounts.state_tax_liability ?? null }
          : {}),
      },
      lines: body.lines.map(l => {
        const line: payRunSvc.PayRunLineInput = {
          employee_id: l.employee_id,
          gross: l.gross,
        };
        if (l.federal_wh !== undefined) line.federal_wh = l.federal_wh;
        if (l.state_wh !== undefined) line.state_wh = l.state_wh;
        if (l.fica_employee !== undefined) line.fica_employee = l.fica_employee;
        if (l.fica_employer !== undefined) line.fica_employer = l.fica_employer;
        if (l.medicare_employee !== undefined) line.medicare_employee = l.medicare_employee;
        if (l.medicare_employer !== undefined) line.medicare_employer = l.medicare_employer;
        if (l.other_deductions !== undefined) line.other_deductions = l.other_deductions;
        return line;
      }),
    };
    const created = await db.transaction().execute(trx =>
      payRunSvc.createDraft(trx, ctxFromReq(req), input),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/pay-runs/:id/finalize', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const finalized = await db.transaction().execute(trx =>
      payRunSvc.finalize(trx, ctxFromReq(req), { pay_run_id: req.params['id']! }),
    );
    res.json(finalized);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/pay-runs/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = payRunVoidSchema.parse(req.body ?? {});
    const input: { pay_run_id: string; void_reason?: string } = { pay_run_id: req.params['id']! };
    if (body.void_reason !== undefined) input.void_reason = body.void_reason;
    const voided = await db.transaction().execute(trx =>
      payRunSvc.voidPayRun(trx, ctxFromReq(req), input),
    );
    res.json(voided);
  } catch (e) { next(e); }
});

export default router;
