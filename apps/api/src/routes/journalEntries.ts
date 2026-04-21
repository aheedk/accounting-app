import { Router } from 'express';
import { schemas, ERR } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as ledger from '../services/core/ledgerService.js';
import { runWithClosedPeriodOverride } from '../services/admin/adminOverrideService.js';
import type { ServiceCtx } from '../lib/ctx.js';
import { BusinessRuleError } from '../lib/errors.js';

const router = Router({ mergeParams: true });

function ctxFromReq(req: any): ServiceCtx {
  return {
    user_id: req.auth!.user_id, firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id, effective_role: req.tenancy!.effective_role,
    request_id: req.request_id, ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/journal-entries', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(String(req.query['limit'] ?? 50), 10) || 50, 200);
    const offset = parseInt(String(req.query['offset'] ?? 0), 10) || 0;
    const status = req.query['status'] as string | undefined;
    let q = db.selectFrom('journal_entries').selectAll().where('business_id', '=', req.tenancy!.business_id);
    if (status) q = q.where('status', '=', status as any);
    const rows = await q.orderBy('entry_date', 'desc').orderBy('created_at', 'desc').limit(limit).offset(offset).execute();
    res.json({ entries: rows, limit, offset });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/journal-entries/:id', async (req, res, next) => {
  try {
    const je = await db.selectFrom('journal_entries').selectAll()
      .where('id', '=', req.params['id']!)
      .where('business_id', '=', req.tenancy!.business_id)
      .executeTakeFirst();
    if (!je) throw new BusinessRuleError(ERR.NOT_FOUND, 'Journal entry not found');
    const lines = await db.selectFrom('journal_entry_lines as jel')
      .innerJoin('chart_of_accounts as a', 'a.id', 'jel.account_id')
      .select(['jel.id', 'jel.line_number', 'jel.account_id', 'a.code as account_code', 'a.name as account_name', 'jel.debit', 'jel.credit', 'jel.memo'])
      .where('jel.journal_entry_id', '=', je.id)
      .orderBy('jel.line_number')
      .execute();
    res.json({ entry: je, lines });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/journal-entries', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.journalEntryCreateSchema.parse(req.body);
    const ctx = ctxFromReq(req);
    const force = req.query['admin_override'] === 'true';
    const reason = (req.body?.admin_override_reason as string | undefined) ?? '';
    const work = (trx: any) =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: req.tenancy!.business_id,
        entry_date: body.entry_date,
        source_type: 'manual',
        memo: body.memo ?? null,
        reference: body.reference ?? null,
        lines: body.lines.map(l => ({ account_id: l.account_id, debit: l.debit, credit: l.credit, memo: l.memo ?? null })),
      });
    const je = force
      ? await runWithClosedPeriodOverride(db, ctx, reason, work)
      : await db.transaction().execute(work);
    res.status(201).json(je);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/journal-entries/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.journalEntryVoidSchema.parse(req.body);
    const ctx = ctxFromReq(req);
    const force = req.query['admin_override'] === 'true';
    const reason = (req.body?.admin_override_reason as string | undefined) ?? '';
    const work = (trx: any) =>
      ledger.voidJournalEntry(trx, ctx, { journal_entry_id: req.params['id']!, void_reason: body.void_reason });
    const reversal = force
      ? await runWithClosedPeriodOverride(db, ctx, reason, work)
      : await db.transaction().execute(work);
    res.json({ reversal });
  } catch (e) { next(e); }
});

export default router;
