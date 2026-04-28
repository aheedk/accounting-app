import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as bankAcctSvc from '../services/banking/bankAccountService.js';
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

router.get('/businesses/:businessId/bank-accounts', async (req, res, next) => {
  try {
    const accounts = await bankAcctSvc.listBankAccounts(db, req.tenancy!.business_id);
    res.json({ bank_accounts: accounts });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/bank-accounts/:id', async (req, res, next) => {
  try {
    res.json(await bankAcctSvc.getBankAccount(db, req.tenancy!.business_id, req.params['id']!));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-accounts', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const body = schemas.bankAccountCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      bankAcctSvc.createBankAccount(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        name: body.name,
        institution: body.institution ?? null,
        account_last_four: body.account_last_four ?? null,
        cash_account_id: body.cash_account_id,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/bank-accounts/:id', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const body = schemas.bankAccountUpdateSchema.parse(req.body);
    const patch: Partial<{ name: string; institution: string | null; account_last_four: string | null; is_active: boolean }> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.institution !== undefined) patch.institution = body.institution ?? null;
    if (body.account_last_four !== undefined) patch.account_last_four = body.account_last_four ?? null;
    if (body.is_active !== undefined) patch.is_active = body.is_active;
    const updated = await db.transaction().execute(trx =>
      bankAcctSvc.updateBankAccount(trx, ctxFromReq(req), { bank_account_id: req.params['id']!, patch }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
