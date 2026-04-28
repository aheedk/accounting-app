import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as reconSvc from '../services/banking/reconciliationService.js';
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

router.get('/businesses/:businessId/reconciliations', async (req, res, next) => {
  try {
    const q: { business_id: string; bank_account_id?: string } = { business_id: req.tenancy!.business_id };
    const bankAccountId = req.query['bank_account_id'];
    if (typeof bankAccountId === 'string') q.bank_account_id = bankAccountId;
    res.json({ reconciliations: await reconSvc.listReconciliations(db, q) });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/reconciliations/:id', async (req, res, next) => {
  try {
    res.json(await reconSvc.getReconciliation(db, req.tenancy!.business_id, req.params['id']!));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/reconciliations', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.reconciliationCreateSchema.parse(req.body);
    const recon = await db.transaction().execute(trx =>
      reconSvc.createReconciliation(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        bank_account_id: body.bank_account_id,
        period_start: body.period_start,
        period_end: body.period_end,
        statement_ending_balance: body.statement_ending_balance,
        memo: body.memo ?? null,
      }),
    );
    res.status(201).json(recon);
  } catch (e) { next(e); }
});

export default router;
