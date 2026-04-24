import { Router, type Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as pr from '../services/accounting/periodReviewService.js';
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

router.get('/businesses/:businessId/fiscal-periods/:periodId/review-tasks', async (req, res, next) => {
  try {
    const tasks = await pr.listForPeriod(db, req.tenancy!.business_id, req.params['periodId']!);
    res.json({ tasks });
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/review-tasks/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.periodReviewTaskUpdateSchema.parse(req.body);
    const patch: Parameters<typeof pr.update>[2]['patch'] = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.assignee_user_id !== undefined) patch.assignee_user_id = body.assignee_user_id ?? null;
    if (body.notes !== undefined) patch.notes = body.notes ?? null;
    const updated = await db.transaction().execute(trx =>
      pr.update(trx, ctxFromReq(req), { task_id: req.params['id']!, patch }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
