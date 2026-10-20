import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as estimateSvc from '../services/ar/estimateService.js';
import type { EstimateStatus } from '../db/types.js';
import type { ServiceCtx } from '../lib/ctx.js';

// Spec: docs/specs/2026-10-20-estimates-design.md
const router = Router({ mergeParams: true });

function ctxFromReq(req: Request): ServiceCtx {
  return {
    user_id: req.auth!.user_id, firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id, effective_role: req.tenancy!.effective_role,
    request_id: req.request_id, ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

const STATUSES: ReadonlyArray<EstimateStatus> = ['pending', 'accepted', 'rejected', 'closed'];
function parseStatus(v: unknown): EstimateStatus | undefined {
  return typeof v === 'string' && (STATUSES as ReadonlyArray<string>).includes(v) ? (v as EstimateStatus) : undefined;
}

function saveInput(req: Request): estimateSvc.SaveEstimateInput {
  const body = schemas.estimateSaveSchema.parse(req.body);
  return {
    business_id: req.tenancy!.business_id,
    customer_id: body.customer_id,
    estimate_date: body.estimate_date,
    expiration_date: body.expiration_date ?? null,
    memo: body.memo ?? null,
    lines: body.lines.map(l => ({
      inventory_item_id: l.inventory_item_id ?? null,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      revenue_account_id: l.revenue_account_id,
      tax_code_id: l.tax_code_id ?? null,
    })),
  };
}

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/estimates', async (req, res, next) => {
  try {
    const q: { business_id: string; status?: EstimateStatus; customer_id?: string } = { business_id: req.tenancy!.business_id };
    const status = parseStatus(req.query['status']);
    if (status) q.status = status;
    const customer_id = req.query['customer_id'];
    if (typeof customer_id === 'string' && /^[0-9a-f-]{36}$/i.test(customer_id)) q.customer_id = customer_id;
    res.json({ estimates: await estimateSvc.listEstimates(db, q) });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/estimates/:id', async (req, res, next) => {
  try {
    res.json(await estimateSvc.getEstimate(db, req.tenancy!.business_id, req.params['id']!));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/estimates', requireMinRole('staff'), async (req, res, next) => {
  try {
    const input = saveInput(req);
    const created = await db.transaction().execute(trx => estimateSvc.createEstimate(trx, ctxFromReq(req), input));
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/estimates/:id', requireMinRole('staff'), async (req, res, next) => {
  try {
    const input = saveInput(req);
    const updated = await db.transaction().execute(trx =>
      estimateSvc.updateEstimate(trx, ctxFromReq(req), { ...input, estimate_id: req.params['id']! }));
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/estimates/:id/status', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.estimateStatusSchema.parse(req.body);
    const updated = await db.transaction().execute(trx =>
      estimateSvc.setEstimateStatus(trx, ctxFromReq(req), {
        estimate_id: req.params['id']!,
        status: body.status,
        ...(body.accepted_by !== undefined ? { accepted_by: body.accepted_by } : {}),
        ...(body.accepted_date !== undefined ? { accepted_date: body.accepted_date } : {}),
      }));
    res.json(updated);
  } catch (e) { next(e); }
});

// Makes a draft invoice; posting it stays an accountant's step, so staff may do this.
router.post('/businesses/:businessId/estimates/:id/convert', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.estimateConvertSchema.parse(req.body ?? {});
    const result = await db.transaction().execute(trx =>
      estimateSvc.convertToInvoice(trx, ctxFromReq(req), {
        estimate_id: req.params['id']!,
        ...(body.issue_date ? { issue_date: body.issue_date } : {}),
      }));
    res.status(201).json(result);
  } catch (e) { next(e); }
});

// Deleting is a firm admin's, as everywhere in the app.
router.delete('/businesses/:businessId/estimates/:id', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx => estimateSvc.deleteEstimate(trx, ctxFromReq(req), { estimate_id: req.params['id']! }));
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
