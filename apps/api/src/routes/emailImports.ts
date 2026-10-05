import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import { suggestCodingBatch, rememberCoding, learningDecision } from '../services/ai/autoCodingService.js';
import {
  cardPaymentSourceAccount,
  checkNumberOf,
  findAlreadyRecorded,
  guessCardAccount,
  isInflow,
  postStatementLines,
  statementDateToIso,
  type StatementKind,
  type StatementLine,
} from '../services/ai/statementImportService.js';
import { matchStubsToLines } from '../services/ai/checkStubService.js';
import { findSuspenseAccount, getOrCreateSuspenseAccount } from '../services/core/chartOfAccountsService.js';
import type { ServiceCtx } from '../lib/ctx.js';
import type { Request } from 'express';

const router = Router();

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

function ctx(req: Request): ServiceCtx {
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

// List email imports — ?history=1 returns approved+rejected, default returns pending
router.get('/businesses/:businessId/email-imports', async (req, res, next) => {
  try {
    const history = req.query['history'] === '1';
    const bizId = req.tenancy!.business_id;
    const baseQ = db
      .selectFrom('email_import_staging')
      .select(['id', 'business_id', 'gmail_message_id', 'email_from', 'email_subject',
               'received_at', 'extracted_transactions', 'status', 'addressed_to',
               'rejection_reason', 'approved_by_user_id', 'approved_at', 'created_at', 'source',
               'statement_kind', 'account_hint'])
      .orderBy('received_at', 'desc');
    // History: this business's own records + any auto-rejected records (no business match)
    // Pending: only this business's own records
    const q = history
      ? baseQ.where(eb => eb.or([
          eb('business_id', '=', bizId),
          eb.and([eb('business_id', 'is', null), eb('status', '=', 'rejected')]),
        ])).where('status', 'in', ['approved', 'rejected']).limit(100)
      : baseQ.where('business_id', '=', bizId).where('status', '=', 'pending');
    const rows = await q.execute();
    const imports: StagedImportRow[] = rows.map(r => ({
      ...r,
      extracted_transactions: (typeof r.extracted_transactions === 'string'
        ? JSON.parse(r.extracted_transactions) as unknown
        : r.extracted_transactions) as StagedTransaction[],
      suggested_statement_account_id: null,
    }));

    // Resolve auto-coding suggestions for everything still awaiting review.
    // History rows are already decided, so there is nothing to suggest.
    if (!history) {
      await attachSuggestions(ctx(req), imports);
      await attachCardContext(bizId, imports);
      await attachCheckStubs(bizId, imports);
      await attachSuspense(ctx(req), bizId, imports);
    }

    res.json({ imports });
  } catch (e) { next(e); }
});

type StagedTransaction = StatementLine & {
  suggestion?: { confidence: number; band: string; source_layer: string } | null;
  /** A check stub that describes this check (bank statements only). */
  check_stub?: {
    id: string; check_number: string | null; payee_name: string | null; memo: string | null;
    amount: string; check_date: string | null; suggested_account_id: string | null;
  } | null;
};

type StagedImportRow = {
  statement_kind: StatementKind;
  account_hint: string | null;
  extracted_transactions: StagedTransaction[];
  /** The card account a credit card statement most likely belongs to. */
  suggested_statement_account_id: string | null;
};

/**
 * Run the auto-coding engine over every pending transaction and attach the
 * result in place. One engine context is loaded for the whole page rather than
 * one per transaction.
 */
async function attachSuggestions(
  serviceCtx: ServiceCtx,
  imports: StagedImportRow[],
): Promise<void> {
  const flat = imports.flatMap(row => row.extracted_transactions ?? []);
  if (flat.length === 0) return;

  const suggestions = await suggestCodingBatch(db, serviceCtx, flat.map(tx => ({
    description: tx.description ?? '',
    amount: `${Math.abs(Number(tx.amount ?? 0))}`,
    direction: isInflow(tx) ? 'credit' as const : 'debit' as const,
    ai_suggested_account: tx.suggested_offset ?? null,
  })));

  flat.forEach((tx, i) => {
    const suggestion = suggestions[i];
    if (!suggestion) { tx.suggestion = null; return; }
    // The UI already preselects from suggested_account_id.
    const accountId = suggestion.lines[0]?.account_id;
    if (accountId) tx.suggested_account_id = accountId;
    tx.suggestion = {
      confidence: suggestion.confidence,
      band: suggestion.band,
      source_layer: suggestion.source_layer,
    };
  });
}

/**
 * Card statements: which card they belong to, and where each payment came
 * from. The engine's credit-card-payment rule points a payment at the card,
 * which is this statement's own account, so a card payment is pointed at the
 * bank account it was paid from instead.
 */
async function attachCardContext(businessId: string, imports: StagedImportRow[]): Promise<void> {
  for (const row of imports) {
    if (row.statement_kind !== 'credit_card') continue;
    row.suggested_statement_account_id = await guessCardAccount(db, businessId, row.account_hint);
    for (const tx of row.extracted_transactions) {
      if (tx.card_type !== 'payment' || tx.auto_posted) continue;
      const source = await cardPaymentSourceAccount(db, businessId, tx.description ?? '');
      if (!source) { delete tx.suggested_account_id; tx.suggestion = null; continue; }
      tx.suggested_account_id = source.account_id;
      const confidence = source.confident ? 90 : 72;
      tx.suggestion = { confidence, band: confidence >= 90 ? 'preselected' : 'suggested', source_layer: 'accounting_rule' };
    }
  }
}

/** Bank statements: pair check lines with uploaded check stubs, and let a stub's category lead. */
async function attachCheckStubs(businessId: string, imports: StagedImportRow[]): Promise<void> {
  for (const row of imports) {
    if (row.statement_kind !== 'bank') continue;
    const matches = await matchStubsToLines(db, businessId, row.extracted_transactions.map((tx, index) => ({
      index,
      check_number: checkNumberOf(tx),
      amount: tx.amount,
      date: statementDateToIso(tx.date ?? ''),
      is_check: !isInflow(tx) && tx.type === 'check',
    })));
    for (const [index, stub] of matches) {
      const tx = row.extracted_transactions[index];
      if (!tx || tx.auto_posted) continue;
      tx.check_stub = {
        id: stub.id, check_number: stub.check_number, payee_name: stub.payee_name, memo: stub.memo,
        amount: stub.amount, check_date: stub.check_date, suggested_account_id: stub.suggested_account_id,
      };
      if (stub.suggested_account_id) {
        tx.suggested_account_id = stub.suggested_account_id;
        tx.suggestion = { confidence: 88, band: 'suggested', source_layer: 'check_stub' };
      }
    }
  }
}

// Combined pending count for both bank statements + invoices — used by the sidebar badge
router.get('/businesses/:businessId/email-imports/pending-count', async (req, res, next) => {
  try {
    const bizId = req.tenancy!.business_id;
    const bankRow = await db
      .selectFrom('email_import_staging')
      .select(eb => eb.fn.countAll<number>().as('count'))
      .where('business_id', '=', bizId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    const invRow = await db
      .selectFrom('invoice_import_staging')
      .select(eb => eb.fn.countAll<number>().as('count'))
      .where('business_id', '=', bizId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    res.json({ count: Number(bankRow?.count ?? 0) + Number(invRow?.count ?? 0) });
  } catch (e) { next(e); }
});

// Serve the original PDF attachment
router.get(
  '/businesses/:businessId/email-imports/:importId/pdf',
  requireMinRole('staff'),
  async (req, res, next) => {
    try {
      const bizId = req.tenancy!.business_id;
      const row = await db
        .selectFrom('email_import_staging')
        .select(['pdf_data', 'gmail_message_id'])
        .where('id', '=', req.params['importId']!)
        .where('business_id', '=', bizId)
        .executeTakeFirst();
      if (!row?.pdf_data) { res.status(404).json({ error: 'PDF not available' }); return; }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="bank-statement-${row.gmail_message_id}.pdf"`);
      res.send(row.pdf_data);
    } catch (e) { next(e); }
  },
);

const approveSchema = z.object({
  /** The statement's own account: the bank account, or the card for a card statement. */
  bank_account_id: z.string().uuid(),
  transactions: z.array(z.object({
    index: z.number().int().min(0),
    offset_account_id: z.string().uuid(),
    include: z.boolean().default(true),
    /** "Use this account for future <vendor> transactions" was ticked. */
    remember: z.boolean().optional(),
    /** Payee / vendor name edited by the reviewer. */
    payee_name: z.string().optional(),
    /** A check stub the reviewer accepted for this check. */
    check_stub_id: z.string().uuid().nullable().optional(),
  })),
});

function parseLines(raw: unknown): StatementLine[] {
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as StatementLine[];
}

// Approve: post each included transaction as a journal entry
/**
 * Whatever is still uncoded waits in Suspense instead of blocking the
 * statement. Runs last: every real suggestion (engine, card, stub) wins.
 */
async function attachSuspense(serviceCtx: ServiceCtx, businessId: string, imports: StagedImportRow[]): Promise<void> {
  const uncoded = imports.flatMap(row => row.extracted_transactions)
    .filter(tx => !tx.auto_posted && !tx.suggested_account_id);
  if (uncoded.length === 0) return;
  const suspense = await db.transaction().execute(trx => getOrCreateSuspenseAccount(trx, serviceCtx, businessId));
  for (const tx of uncoded) {
    tx.suggested_account_id = suspense.id;
    tx.suggestion = { confidence: 0, band: 'unclassified', source_layer: 'suspense' };
  }
}

router.post(
  '/businesses/:businessId/email-imports/:importId/approve',
  requireMinRole('accountant'),
  async (req, res, next) => {
    try {
      const body = approveSchema.parse(req.body);
      const bizId = req.tenancy!.business_id;
      const serviceCtx = ctx(req);

      const staged = await db
        .selectFrom('email_import_staging')
        .selectAll()
        .where('id', '=', req.params['importId']!)
        .where('status', '=', 'pending')
        .executeTakeFirst();

      if (!staged) { res.status(404).json({ error: 'Import not found or already processed' }); return; }

      const transactions = parseLines(staged.extracted_transactions);
      const included = body.transactions.filter(t => t.include);

      // Recompute the suggestions server-side rather than trusting what the
      // client says was suggested -- this decides what gets learned.
      const suggestions = await suggestCodingBatch(db, serviceCtx, transactions.map(tx => ({
        description: tx.description ?? '',
        amount: `${Math.abs(Number(tx.amount ?? 0))}`,
        direction: isInflow(tx) ? 'credit' as const : 'debit' as const,
      })));

      // Parking a line in Suspense says nothing about the vendor.
      const suspenseId = (await findSuspenseAccount(db, bizId))?.id ?? null;
      let learned = 0;
      const created = await db.transaction().execute(async trx => {
        const entryIds = await postStatementLines(trx, serviceCtx, {
          staging_id: staged.id,
          statement_kind: staged.statement_kind,
          lines: transactions,
          account_id: body.bank_account_id,
          items: included.map(item => ({
            index: item.index,
            offset_account_id: item.offset_account_id,
            payee_name: item.payee_name ?? null,
            check_stub_id: item.check_stub_id ?? null,
          })),
        });

        for (let i = 0; i < included.length; i += 1) {
          const item = included[i]!;
          const tx = transactions[item.index];
          // Only lines this approval actually posted teach the engine; card
          // payments say nothing about a vendor.
          if (!tx || !entryIds[i] || tx.card_type === 'payment' || item.offset_account_id === suspenseId) continue;
          const suggestion = suggestions[item.index] ?? null;
          const decision = learningDecision({
            suggestedAccountId: suggestion?.lines[0]?.account_id ?? null,
            chosenAccountId: item.offset_account_id,
            sourceLayer: suggestion?.source_layer ?? null,
            userAskedToRemember: item.remember === true,
          });
          if (!decision) continue;

          const amt = Number(tx.amount).toFixed(4);
          const inflow = isInflow(tx);
          await rememberCoding(trx, serviceCtx, {
            description: tx.description,
            direction: inflow ? 'credit' : 'debit',
            // Client-wide: the prompt says "future <vendor> transactions",
            // not "future transactions on this bank account".
            bank_account_id: null,
            lines: [{
              account_id: item.offset_account_id,
              debit: inflow ? '0.0000' : amt,
              credit: inflow ? amt : '0.0000',
              memo: null,
            }],
            was_correction: decision.wasCorrection,
          });
          learned += 1;
        }

        await trx
          .updateTable('email_import_staging')
          .set({
            status: 'approved',
            business_id: bizId,
            approved_by_user_id: serviceCtx.user_id,
            approved_at: new Date().toISOString(),
          })
          .where('id', '=', staged.id)
          .execute();
        return entryIds;
      });

      res.json({ ok: true, posted: created.filter(Boolean).length, learned });
    } catch (e) { next(e); }
  },
);

const alreadyRecordedSchema = z.object({
  bank_account_id: z.string().uuid(),
  lines: z.array(z.object({ index: z.number().int().min(0), offset_account_id: z.string().uuid() })),
});

/**
 * Lines whose money movement is already in the books from another document
 * (a card payment on both statements, a transfer on both bank statements).
 */
router.post(
  '/businesses/:businessId/email-imports/:importId/already-recorded',
  async (req, res, next) => {
    try {
      const body = alreadyRecordedSchema.parse(req.body);
      const staged = await db.selectFrom('email_import_staging')
        .select(['id', 'extracted_transactions'])
        .where('id', '=', req.params['importId']!)
        .where('business_id', '=', req.tenancy!.business_id)
        .executeTakeFirst();
      if (!staged) { res.status(404).json({ error: 'Import not found' }); return; }
      const matches = await findAlreadyRecorded(db, ctx(req), {
        staging_id: staged.id,
        account_id: body.bank_account_id,
        lines: parseLines(staged.extracted_transactions),
        offsets: body.lines,
      });
      res.json({ matches });
    } catch (e) { next(e); }
  },
);

const autoPostSchema = z.object({ bank_account_id: z.string().uuid() });

/**
 * Post only the rows the engine is confident about (band "auto_post"), leaving
 * everything else pending for review.
 *
 * Requires the business to have opted in: posting to the ledger without a human
 * reviewing each line is a firm policy decision, so it is off by default. A
 * human still identifies the document and chooses the bank account -- the cash
 * side of the entry cannot be inferred from the statement.
 */
router.post(
  '/businesses/:businessId/email-imports/:importId/auto-post',
  requireMinRole('accountant'),
  async (req, res, next) => {
    try {
      const body = autoPostSchema.parse(req.body);
      const bizId = req.tenancy!.business_id;
      const serviceCtx = ctx(req);

      const business = await db.selectFrom('businesses')
        .select(['ai_auto_post_enabled'])
        .where('id', '=', bizId)
        .executeTakeFirst();
      if (!business?.ai_auto_post_enabled) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Auto-post is turned off for this client.',
          },
        });
        return;
      }

      const staged = await db.selectFrom('email_import_staging').selectAll()
        .where('id', '=', req.params['importId']!)
        .where('business_id', '=', bizId)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (!staged) { res.status(404).json({ error: 'Import not found or already processed' }); return; }

      const transactions = parseLines(staged.extracted_transactions);

      const suggestions = await suggestCodingBatch(db, serviceCtx, transactions.map(tx => ({
        description: tx.description ?? '',
        amount: `${Math.abs(Number(tx.amount ?? 0))}`,
        direction: isInflow(tx) ? 'credit' as const : 'debit' as const,
      })));

      const confident = transactions.flatMap((tx, index) => {
        // A card payment's suggestion points at the card itself; never auto-post it.
        if (tx.auto_posted || tx.card_type === 'payment') return [];
        const suggestion = suggestions[index];
        if (!suggestion || suggestion.band !== 'auto_post') return [];
        const accountId = suggestion.lines[0]?.account_id;
        return accountId && accountId !== body.bank_account_id ? [{ tx, index, accountId }] : [];
      });

      if (confident.length === 0) {
        res.json({ ok: true, posted: 0, remaining: transactions.filter(t => !t.auto_posted).length });
        return;
      }

      await db.transaction().execute(async trx => {
        await postStatementLines(trx, serviceCtx, {
          staging_id: staged.id,
          statement_kind: staged.statement_kind,
          lines: transactions,
          account_id: body.bank_account_id,
          items: confident.map(({ index, accountId }) => ({ index, offset_account_id: accountId })),
        });
        for (const { index } of confident) transactions[index]!.auto_posted = true;
        const remainingNow = transactions.filter(t => !t.auto_posted).length;
        await trx.updateTable('email_import_staging')
          .set({
            extracted_transactions: JSON.stringify(transactions),
            // Nothing left to review means the document is done.
            ...(remainingNow === 0 ? {
              status: 'approved',
              approved_by_user_id: serviceCtx.user_id,
              approved_at: new Date().toISOString(),
            } : {}),
          })
          .where('id', '=', staged.id)
          .execute();
      });
      const remaining = transactions.filter(t => !t.auto_posted).length;

      res.json({ ok: true, posted: confident.length, remaining });
    } catch (e) { next(e); }
  },
);

// Reject: mark as rejected without posting
router.post(
  '/businesses/:businessId/email-imports/:importId/reject',
  requireMinRole('accountant'),
  async (req, res, next) => {
    try {
      const result = await db
        .updateTable('email_import_staging')
        .set({ status: 'rejected', business_id: req.tenancy!.business_id })
        .where('id', '=', req.params['importId']!)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (!result.numUpdatedRows) { res.status(404).json({ error: 'Import not found or already processed' }); return; }
      res.json({ ok: true });
    } catch (e) { next(e); }
  },
);

export default router;
