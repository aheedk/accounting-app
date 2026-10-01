import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as depositSvc from '../services/banking/bankDepositService.js';
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

router.get('/businesses/:businessId/bank-deposits', async (req, res, next) => {
  try {
    const list = await depositSvc.listDeposits(db, ctxFromReq(req));
    res.json(list);
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/bank-deposits/:id', async (req, res, next) => {
  try {
    const deposit = await depositSvc.getDeposit(db, ctxFromReq(req), req.params['id']!);
    res.json(deposit);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-deposits',
  requireMinRole('staff'),
  async (req, res, next) => {
    try {
      const body = schemas.bankDepositCreateSchema.parse(req.body) as depositSvc.CreateDepositInput;
      const ctx = ctxFromReq(req);
      const deposit = await db.transaction().execute(trx =>
        depositSvc.createDeposit(trx, ctx, body),
      );
      res.status(201).json(deposit);
    } catch (e) { next(e); }
  },
);

router.delete('/businesses/:businessId/bank-deposits/:id',
  requireMinRole('accountant'),
  async (req, res, next) => {
    try {
      await db.transaction().execute(trx =>
        depositSvc.deleteDeposit(trx, ctxFromReq(req), req.params['id']!),
      );
      res.status(204).end();
    } catch (e) { next(e); }
  },
);

export default router;
