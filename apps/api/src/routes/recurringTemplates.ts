import { Router, type Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as rt from '../services/accounting/recurringTemplateService.js';
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

router.get('/businesses/:businessId/recurring-templates', async (req, res, next) => {
  try { res.json({ templates: await rt.listTemplates(db, req.tenancy!.business_id) }); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/recurring-templates', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.recurringTemplateCreateSchema.parse(req.body);
    const input: Parameters<typeof rt.create>[2] = {
      business_id: req.tenancy!.business_id,
      name: body.name,
      template_type: body.template_type,
      payload: body.payload,
      recurrence: body.recurrence,
      next_run_date: body.next_run_date,
    };
    if (body.end_date !== undefined) input.end_date = body.end_date ?? null;
    const created = await db.transaction().execute(trx => rt.create(trx, ctxFromReq(req), input));
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/recurring-templates/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx =>
      rt.deleteTemplate(trx, ctxFromReq(req), { template_id: req.params['id']! }),
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/recurring-templates/run-due', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const results = await db.transaction().execute(trx => rt.runDue(trx, ctxFromReq(req), req.tenancy!.business_id));
    res.json({ results });
  } catch (e) { next(e); }
});

export default router;
