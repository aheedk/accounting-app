import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as reconSvc from '../services/banking/bankReconciliationWorksheetService.js';
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

router.get('/businesses/:businessId/bank-rec/accounts', async (req, res, next) => {
  try {
    res.json({ accounts: await reconSvc.listReconcilableAccounts(db, ctxFromReq(req)) });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/bank-rec/status', async (req, res, next) => {
  try {
    const accountId = req.query['account_id'];
    if (typeof accountId !== 'string') { res.status(400).json({ error: 'account_id is required' }); return; }
    res.json(await reconSvc.getStatus(db, ctxFromReq(req), accountId));
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/bank-rec/history', async (req, res, next) => {
  try {
    const accountId = req.query['account_id'];
    const q: { account_id?: string } = typeof accountId === 'string' ? { account_id: accountId } : {};
    res.json({ reconciliations: await reconSvc.listHistory(db, ctxFromReq(req), q) });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/bank-rec/:id', async (req, res, next) => {
  try {
    res.json(await reconSvc.getReconciliationDetail(db, ctxFromReq(req), req.params['id']!));
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/bank-rec/:id/worksheet', async (req, res, next) => {
  try {
    res.json(await reconSvc.getWorksheet(db, ctxFromReq(req), req.params['id']!));
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/bank-rec/:id/statement-match', async (req, res, next) => {
  try {
    res.json({ match: await reconSvc.getStatementMatch(db, ctxFromReq(req), req.params['id']!) });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-rec/start', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.reconciliationStartSchema.parse(req.body) as reconSvc.StartReconciliationInput;
    const ctx = ctxFromReq(req);
    const recon = await db.transaction().execute(trx => reconSvc.startReconciliation(trx, ctx, body));
    res.status(201).json(recon);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/bank-rec/:id/items', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.reconciliationSaveItemsSchema.parse(req.body);
    const ctx = ctxFromReq(req);
    const result = await db.transaction().execute(trx => reconSvc.saveProgress(trx, ctx, req.params['id']!, body.items));
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-rec/:id/finish', requireMinRole('accountant'), async (req, res, next) => {
  try {
    // Nothing to send: it finishes only at a zero difference (item 94).
    const ctx = ctxFromReq(req);
    const result = await db.transaction().execute(trx => reconSvc.finishReconciliation(trx, ctx, req.params['id']!));
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-rec/:id/cancel', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const ctx = ctxFromReq(req);
    const result = await db.transaction().execute(trx => reconSvc.cancelReconciliation(trx, ctx, req.params['id']!));
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-rec/:id/undo', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const ctx = ctxFromReq(req);
    const result = await db.transaction().execute(trx => reconSvc.undoReconciliation(trx, ctx, req.params['id']!));
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
