import { Router } from 'express';
import type { Request } from 'express';
import type { Transaction } from 'kysely';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import type { DB, JournalEntryStatus } from '../db/types.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as ledger from '../services/core/ledgerService.js';
import * as journalQueries from '../services/core/journalEntryQueryService.js';
import { peekNextCounter } from '../services/core/numberingService.js';
import { runWithClosedPeriodOverride } from '../services/admin/adminOverrideService.js';
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

router.get('/businesses/:businessId/journal-entries', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(String(req.query['limit'] ?? 50), 10) || 50, 200);
    const offset = parseInt(String(req.query['offset'] ?? 0), 10) || 0;
    const status = req.query['status'] as string | undefined;
    const periodStart = req.query['period_start'] as string | undefined;
    const periodEnd = req.query['period_end'] as string | undefined;
    const result = await journalQueries.listJournalEntries(db, ctxFromReq(req), {
      limit,
      offset,
      ...(status ? { status: status as JournalEntryStatus } : {}),
      ...(periodStart ? { period_start: periodStart } : {}),
      ...(periodEnd ? { period_end: periodEnd } : {}),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/journal-entries/next-number', async (req, res, next) => {
  try {
    const nextNumber = await peekNextCounter(db, req.tenancy!.business_id, 'journal_entry');
    res.json({ journal_number: String(nextNumber) });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/journal-entries/:id', async (req, res, next) => {
  try {
    const result = await journalQueries.getJournalEntryDetail(db, ctxFromReq(req), req.params['id']!);
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/journal-entries', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.journalEntryCreateSchema.parse(req.body);
    const ctx = ctxFromReq(req);
    const force = req.query['admin_override'] === 'true';
    const reason = (req.body?.admin_override_reason as string | undefined) ?? '';
    const work = (trx: Transaction<DB>) =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: req.tenancy!.business_id,
        entry_date: body.entry_date,
        journal_number: body.journal_number ?? null,
        source_type: body.is_adjusting ? 'adjustment' : 'manual',
        memo: body.memo ?? null,
        reference: body.reference ?? null,
        lines: body.lines.map(l => ({
          account_id: l.account_id,
          debit: l.debit,
          credit: l.credit,
          memo: l.memo ?? null,
          name: l.name ?? null,
          class_name: l.class_name ?? null,
        })),
      });
    const je = force
      ? await runWithClosedPeriodOverride(db, ctx, reason, work)
      : await db.transaction().execute(work);
    res.status(201).json(je);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/journal-entries/:id/correct', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.journalEntryCorrectionSchema.parse(req.body);
    const ctx = ctxFromReq(req);
    const force = req.query['admin_override'] === 'true';
    const reason = (req.body?.admin_override_reason as string | undefined) ?? '';
    const work = (trx: Transaction<DB>) =>
      ledger.correctJournalEntry(trx, ctx, {
        journal_entry_id: req.params['id']!,
        replacement: {
          business_id: req.tenancy!.business_id,
          entry_date: body.entry_date,
          journal_number: body.journal_number ?? null,
          source_type: body.is_adjusting ? 'adjustment' : 'manual',
          memo: body.memo ?? null,
          reference: body.reference ?? null,
          lines: body.lines.map(line => ({
            account_id: line.account_id,
            debit: line.debit,
            credit: line.credit,
            memo: line.memo ?? null,
            name: line.name ?? null,
            class_name: line.class_name ?? null,
          })),
        },
      });
    const result = force
      ? await runWithClosedPeriodOverride(db, ctx, reason, work)
      : await db.transaction().execute(work);
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/journal-entries/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.journalEntryVoidSchema.parse(req.body);
    const ctx = ctxFromReq(req);
    const force = req.query['admin_override'] === 'true';
    const reason = (req.body?.admin_override_reason as string | undefined) ?? '';
    const work = (trx: Transaction<DB>) =>
      ledger.voidJournalEntry(trx, ctx, { journal_entry_id: req.params['id']!, void_reason: body.void_reason });
    const reversal = force
      ? await runWithClosedPeriodOverride(db, ctx, reason, work)
      : await db.transaction().execute(work);
    res.json({ reversal });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/journal-entries/:id/reverse', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const ctx = ctxFromReq(req);
    const force = req.query['admin_override'] === 'true';
    const reason = (req.body?.admin_override_reason as string | undefined) ?? '';
    const work = (trx: Transaction<DB>) =>
      ledger.reverseJournalEntry(trx, ctx, { journal_entry_id: req.params['id']! });
    const reversal = force
      ? await runWithClosedPeriodOverride(db, ctx, reason, work)
      : await db.transaction().execute(work);
    res.status(201).json({ reversal });
  } catch (e) { next(e); }
});

export default router;
