import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import { postJournalEntryBatch } from '../services/core/ledgerService.js';
import { suggestCodingBatch, rememberCoding, learningDecision } from '../services/ai/autoCodingService.js';
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
               'rejection_reason', 'approved_by_user_id', 'approved_at', 'created_at'])
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
    const imports = rows.map(r => ({
      ...r,
      extracted_transactions: (typeof r.extracted_transactions === 'string'
        ? JSON.parse(r.extracted_transactions) as unknown
        : r.extracted_transactions) as StagedTransaction[],
    }));

    // Resolve auto-coding suggestions for everything still awaiting review.
    // History rows are already decided, so there is nothing to suggest.
    if (!history) await attachSuggestions(ctx(req), imports);

    res.json({ imports });
  } catch (e) { next(e); }
});

type StagedTransaction = {
  description?: string;
  amount?: string;
  type?: 'debit' | 'credit';
  suggested_offset?: string;
  suggested_account_id?: string;
  suggestion?: { confidence: number; band: string; source_layer: string } | null;
};

/**
 * Run the auto-coding engine over every pending transaction and attach the
 * result in place. One engine context is loaded for the whole page rather than
 * one per transaction.
 */
async function attachSuggestions(
  serviceCtx: ServiceCtx,
  imports: Array<{ extracted_transactions: StagedTransaction[] }>,
): Promise<void> {
  const flat = imports.flatMap(row => row.extracted_transactions ?? []);
  if (flat.length === 0) return;

  const suggestions = await suggestCodingBatch(db, serviceCtx, flat.map(tx => ({
    description: tx.description ?? '',
    amount: `${Math.abs(Number(tx.amount ?? 0))}`,
    direction: tx.type === 'credit' ? 'credit' as const : 'debit' as const,
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
  bank_account_id: z.string().uuid(),
  transactions: z.array(z.object({
    index: z.number().int().min(0),
    offset_account_id: z.string().uuid(),
    include: z.boolean().default(true),
    /** "Use this account for future <vendor> transactions" was ticked. */
    remember: z.boolean().optional(),
  })),
});

// Approve: post each included transaction as a journal entry
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

      type RawTx = { date: string; description: string; amount: string; type: 'debit' | 'credit'; balance: string };
      const transactions: RawTx[] = (typeof staged.extracted_transactions === 'string'
        ? JSON.parse(staged.extracted_transactions)
        : staged.extracted_transactions) as RawTx[];

      const included = body.transactions.filter(t => t.include);

      // Build all journal entry inputs up-front, then post as a single batch.
      // This reduces DB round-trips from ~8N to ~8 for N transactions.
      type RawTxWithItem = { tx: RawTx; item: typeof included[0] };
      const pairs: RawTxWithItem[] = [];
      for (const item of included) {
        const tx = transactions[item.index];
        if (tx) pairs.push({ tx, item });
      }

      const jeInputs = pairs.map(({ tx, item }) => {
        const amt = parseFloat(tx.amount).toFixed(2);
        const isDeposit = tx.type === 'credit';
        const [m, d, y] = tx.date.split('/');
        const entryDate = `${y}-${m?.padStart(2, '0')}-${d?.padStart(2, '0')}`;
        return {
          business_id: bizId,
          entry_date: entryDate,
          source_type: 'bank_import' as const,
          source_id: staged.id,
          memo: tx.description,
          lines: [
            {
              account_id: body.bank_account_id,
              debit: isDeposit ? amt : '0.00',
              credit: isDeposit ? '0.00' : amt,
              memo: tx.description,
            },
            {
              account_id: item.offset_account_id,
              debit: isDeposit ? '0.00' : amt,
              credit: isDeposit ? amt : '0.00',
              memo: tx.description,
            },
          ],
        };
      });

      // Recompute the suggestions server-side rather than trusting what the
      // client says was suggested -- this decides what gets learned.
      const suggestions = await suggestCodingBatch(db, serviceCtx, transactions.map(tx => ({
        description: tx.description ?? '',
        amount: `${Math.abs(Number(tx.amount ?? 0))}`,
        direction: tx.type === 'credit' ? 'credit' as const : 'debit' as const,
      })));

      const posted = jeInputs.length;
      let learned = 0;
      await db.transaction().execute(async trx => {
        await postJournalEntryBatch(trx, serviceCtx, jeInputs);

        for (const { tx, item } of pairs) {
          const suggestion = suggestions[item.index] ?? null;
          const decision = learningDecision({
            suggestedAccountId: suggestion?.lines[0]?.account_id ?? null,
            chosenAccountId: item.offset_account_id,
            sourceLayer: suggestion?.source_layer ?? null,
            userAskedToRemember: item.remember === true,
          });
          if (!decision) continue;

          const amt = parseFloat(tx.amount).toFixed(4);
          const isDeposit = tx.type === 'credit';
          await rememberCoding(trx, serviceCtx, {
            description: tx.description,
            direction: isDeposit ? 'credit' : 'debit',
            // Client-wide: the prompt says "future <vendor> transactions",
            // not "future transactions on this bank account".
            bank_account_id: null,
            lines: [{
              account_id: item.offset_account_id,
              debit: isDeposit ? '0.0000' : amt,
              credit: isDeposit ? amt : '0.0000',
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
      });

      res.json({ ok: true, posted, learned });
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
