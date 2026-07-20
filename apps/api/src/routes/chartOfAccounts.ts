import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as coa from '../services/core/chartOfAccountsService.js';
import type { ServiceCtx } from '../lib/ctx.js';

const router = Router({ mergeParams: true });

function ctxFromReq(req: Request): ServiceCtx {
  return {
    user_id: req.auth!.user_id,
    firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id,
    effective_role: req.tenancy!.effective_role,
    request_id: req.request_id,
    ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/coa', async (req, res, next) => {
  try {
    const list = await coa.listAccounts(db, { business_id: req.tenancy!.business_id, include_inactive: req.query['include_inactive'] === 'true' });
    res.json({ accounts: list });
  } catch (e) { next(e); }
});

// QBO-style account register: posted ledger lines + running balance. Read-only (staff+).
router.get('/businesses/:businessId/coa/:accountId/register', async (req, res, next) => {
  try {
    const out = await coa.listAccountRegister(db, {
      business_id: req.tenancy!.business_id,
      account_id: req.params['accountId']!,
    });
    res.json(out);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/coa', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.accountCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      coa.createAccount(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        code: body.code, name: body.name, account_type: body.account_type,
        parent_id: body.parent_id ?? null,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/coa/:accountId', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const parsed = schemas.accountUpdateSchema.parse(req.body);
    const patch: { code?: string; name?: string; parent_id?: string | null; is_active?: boolean } = {};
    if (parsed.code !== undefined) patch.code = parsed.code;
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.parent_id !== undefined) patch.parent_id = parsed.parent_id;
    if (parsed.is_active !== undefined) patch.is_active = parsed.is_active;
    const updated = await db.transaction().execute(trx =>
      coa.updateAccount(trx, ctxFromReq(req), {
        account_id: req.params['accountId']!,
        patch,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
