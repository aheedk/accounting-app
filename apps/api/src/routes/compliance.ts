import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as complianceSvc from '../services/payroll/complianceService.js';
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

router.get('/businesses/:businessId/compliance-items', async (req, res, next) => {
  try {
    const items = await complianceSvc.listForBusiness(db, req.tenancy!.business_id);
    res.json({ items });
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/compliance-items/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.complianceItemUpdateSchema.parse(req.body);
    const patch: {
      status?: 'open' | 'in_progress' | 'done' | 'na';
      due_date?: string | null;
      notes?: string | null;
      document_file_id?: string | null;
    } = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.due_date !== undefined) patch.due_date = body.due_date;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.document_file_id !== undefined) patch.document_file_id = body.document_file_id;

    const updated = await db.transaction().execute(trx =>
      complianceSvc.update(trx, ctxFromReq(req), {
        item_id: req.params['id']!,
        patch,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
