import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import { createTransfer } from '../services/banking/transferService.js';
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

// Posts a journal entry, so it takes the same role a journal entry does.
router.post('/businesses/:businessId/transfers', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.transferCreateSchema.parse(req.body);
    const entry = await db.transaction().execute(trx => createTransfer(trx, ctxFromReq(req), {
      from_account_id: body.from_account_id,
      to_account_id: body.to_account_id,
      amount: body.amount,
      transfer_date: body.transfer_date,
      memo: body.memo ?? null,
    }));
    res.status(201).json(entry);
  } catch (e) { next(e); }
});

export default router;
