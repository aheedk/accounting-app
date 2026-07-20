import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as coa from '../services/core/chartOfAccountsService.js';
import * as ledger from '../services/core/ledgerService.js';
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

// QBO-style account register: ledger lines + running balance (natural sign)
// with each entry's counter account. Read-only (staff+).
router.get('/businesses/:businessId/coa/:accountId/register', async (req, res, next) => {
  try {
    const out = await coa.listAccountRegister(db, {
      business_id: req.tenancy!.business_id,
      account_id: req.params['accountId']!,
    });
    res.json(out);
  } catch (e) { next(e); }
});

// Single account + its current balance (edit drawer header). Balance comes
// from the ledger service so drafts are excluded and void pairs cancel.
router.get('/businesses/:businessId/coa/:accountId', async (req, res, next) => {
  try {
    const businessId = req.tenancy!.business_id;
    const accountId = req.params['accountId']!;
    const account = await db.selectFrom('chart_of_accounts').selectAll()
      .where('id', '=', accountId)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }

    const asOf = new Date().toISOString().slice(0, 10);
    const balance = await ledger.computeAccountBalance(db, { account_id: accountId, as_of: asOf });
    res.json({ ...account, balance });
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
        detail_type: body.detail_type ?? null,
        description: body.description ?? null,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/coa/:accountId', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const parsed = schemas.accountUpdateSchema.parse(req.body);
    const patch: {
      code?: string;
      name?: string;
      parent_id?: string | null;
      is_active?: boolean;
      detail_type?: string | null;
      description?: string | null;
    } = {};
    if (parsed.code !== undefined) patch.code = parsed.code;
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.parent_id !== undefined) patch.parent_id = parsed.parent_id;
    if (parsed.is_active !== undefined) patch.is_active = parsed.is_active;
    if (parsed.detail_type !== undefined) patch.detail_type = parsed.detail_type;
    if (parsed.description !== undefined) patch.description = parsed.description;
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
