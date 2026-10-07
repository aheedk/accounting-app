import { Router, type Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as checkSvc from '../services/ap/checkService.js';
import * as auditService from '../services/audit/auditService.js';
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

router.get('/businesses/:businessId/checks', async (req, res, next) => {
  try { res.json({ checks: await checkSvc.listChecks(db, ctxFromReq(req)) }); }
  catch (e) { next(e); }
});

router.get('/businesses/:businessId/checks/next-number', async (req, res, next) => {
  try {
    const bankAccountId = String(req.query['bank_account_id'] ?? '');
    if (!bankAccountId) { res.json({ check_number: null }); return; }
    const check_number = await checkSvc.nextCheckNumber(db, req.tenancy!.business_id, bankAccountId);
    res.json({ check_number });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/checks/vendor-default-category', async (req, res, next) => {
  try {
    const vendorId = String(req.query['vendor_id'] ?? '');
    if (!vendorId) { res.json({ account_id: null }); return; }
    const account_id = await checkSvc.vendorDefaultCategory(db, req.tenancy!.business_id, vendorId);
    res.json({ account_id });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/checks/:id', async (req, res, next) => {
  try { res.json(await checkSvc.getCheck(db, ctxFromReq(req), req.params['id']!)); }
  catch (e) { next(e); }
});

router.get('/businesses/:businessId/checks/:id/audit-history', async (req, res, next) => {
  try {
    const history = await auditService.listByEntity(
      db, req.tenancy!.business_id, 'check', req.params['id']!,
    );
    res.json({ history });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/checks', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.checkCreateSchema.parse(req.body) as checkSvc.CreateCheckInput;
    const ctx = ctxFromReq(req);
    const created = await db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, body));
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/checks/:id', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.checkUpdateSchema.parse(req.body) as checkSvc.CreateCheckInput;
    const ctx = ctxFromReq(req);
    const updated = await db.transaction().execute(trx => checkSvc.updateCheck(trx, ctx, req.params['id']!, body));
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/checks/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.checkVoidSchema.parse(req.body ?? {});
    const updated = await db.transaction().execute(trx =>
      checkSvc.voidCheck(trx, ctxFromReq(req), {
        check_id: req.params['id']!,
        ...(body.void_reason !== undefined ? { void_reason: body.void_reason } : {}),
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/checks/:id', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx => checkSvc.deleteCheck(trx, ctxFromReq(req), req.params['id']!));
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
