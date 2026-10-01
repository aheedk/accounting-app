import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as imported from '../services/banking/importedTransactionService.js';
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

router.get('/businesses/:businessId/imported-transactions/:id', async (req, res, next) => {
  try {
    res.json(await imported.getImportedTransaction(db, ctxFromReq(req), req.params['id']!));
  } catch (e) { next(e); }
});

router.put('/businesses/:businessId/imported-transactions/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.importedTransactionUpdateSchema.parse(req.body);
    const ctx = ctxFromReq(req);
    const updated = await db.transaction().execute(trx =>
      imported.updateImportedTransaction(trx, ctx, {
        journal_entry_id: req.params['id']!,
        entry_date: body.entry_date,
        transaction_type: body.transaction_type,
        payee_name: body.payee_name ?? null,
        check_number: body.check_number ?? null,
        memo: body.memo ?? null,
        bank_account_id: body.bank_account_id,
        category_account_id: body.category_account_id,
        amount: body.amount,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
