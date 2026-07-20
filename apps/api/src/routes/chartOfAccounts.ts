import { Router } from 'express';
import type { Request } from 'express';
import { sql } from 'kysely';
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

router.get('/businesses/:businessId/coa/:accountId/register', async (req, res, next) => {
  try {
    const businessId = req.tenancy!.business_id;
    const accountId = req.params['accountId']!;

    const account = await db.selectFrom('chart_of_accounts').selectAll()
      .where('id', '=', accountId)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }

    const lines = await db.selectFrom('journal_entry_lines as jel')
      .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
      .select([
        'jel.id',
        'jel.debit',
        'jel.credit',
        'jel.memo as line_memo',
        'je.id as journal_entry_id',
        'je.entry_date',
        'je.reference',
        'je.memo as entry_memo',
        'je.source_type',
        'je.status',
      ])
      .where('jel.account_id', '=', accountId)
      .where('je.business_id', '=', businessId)
      .where('je.status', '!=', sql.lit('voided'))
      .orderBy('je.entry_date', 'asc')
      .orderBy('je.created_at', 'asc')
      .execute();

    const jeIds = [...new Set(lines.map(l => l.journal_entry_id))];
    const counterLines = jeIds.length > 0
      ? await db.selectFrom('journal_entry_lines as jel')
          .innerJoin('chart_of_accounts as coa', 'coa.id', 'jel.account_id')
          .select(['jel.journal_entry_id', 'coa.name as account_name'])
          .where('jel.journal_entry_id', 'in', jeIds)
          .where('jel.account_id', '!=', accountId)
          .execute()
      : [];

    const counterMap: Record<string, string> = {};
    for (const cl of counterLines) {
      if (!counterMap[cl.journal_entry_id]) counterMap[cl.journal_entry_id] = cl.account_name;
    }

    let runningBalance = 0;
    const entries = lines.map(l => {
      runningBalance += parseFloat(l.debit) - parseFloat(l.credit);
      return { ...l, counter_account: counterMap[l.journal_entry_id] ?? '—', running_balance: runningBalance.toFixed(2) };
    });
    entries.reverse();

    res.json({ account, entries, balance: runningBalance.toFixed(2) });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/coa/:accountId', async (req, res, next) => {
  try {
    const businessId = req.tenancy!.business_id;
    const accountId = req.params['accountId']!;
    const account = await db.selectFrom('chart_of_accounts').selectAll()
      .where('id', '=', accountId)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (!account) { res.status(404).json({ error: 'Account not found' }); return; }

    const balRow = await db.selectFrom('journal_entry_lines as jel')
      .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
      .select(sql<string>`COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)`.as('balance'))
      .where('jel.account_id', '=', accountId)
      .where('je.business_id', '=', businessId)
      .executeTakeFirst();

    res.json({ ...account, balance: balRow?.balance ?? '0' });
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
      name?: string;
      parent_id?: string | null;
      is_active?: boolean;
      detail_type?: string | null;
      description?: string | null;
    } = {};
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
