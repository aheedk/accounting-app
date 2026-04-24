import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as crSvc from '../services/reports/customReportService.js';
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

router.get('/businesses/:businessId/custom-reports', async (req, res, next) => {
  try {
    res.json({ reports: await crSvc.listReports(db, req.tenancy!.business_id) });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/custom-reports/:id', async (req, res, next) => {
  try {
    res.json(await crSvc.getReport(db, req.tenancy!.business_id, req.params['id']!));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/custom-reports', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.customReportCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      crSvc.createReport(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        name: body.name,
        definition: body.definition,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/custom-reports/:id', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.customReportUpdateSchema.parse(req.body);
    const patch: crSvc.UpdateCustomReportInput['patch'] = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.definition !== undefined) patch.definition = body.definition;
    const updated = await db.transaction().execute(trx =>
      crSvc.updateReport(trx, ctxFromReq(req), { report_id: req.params['id']!, patch }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/custom-reports/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx =>
      crSvc.deleteReport(trx, ctxFromReq(req), { report_id: req.params['id']! }),
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/custom-reports/:id/run', async (req, res, next) => {
  try {
    const report = await crSvc.getReport(db, req.tenancy!.business_id, req.params['id']!);
    const definition = schemas.customReportDefinitionSchema.parse(report.definition);
    const rows = await crSvc.runReport(db, req.tenancy!.business_id, definition);
    res.json({ rows });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/custom-reports/run', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = z.object({ definition: schemas.customReportDefinitionSchema }).parse(req.body);
    const rows = await crSvc.runReport(db, req.tenancy!.business_id, body.definition);
    res.json({ rows });
  } catch (e) { next(e); }
});

export default router;
