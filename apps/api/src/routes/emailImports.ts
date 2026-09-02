import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import { postJournalEntry } from '../services/core/ledgerService.js';
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
    let q = db
      .selectFrom('email_import_staging')
      .selectAll()
      .orderBy('received_at', 'desc');
    q = history
      ? q.where('status', 'in', ['approved', 'rejected']).limit(100)
      : q.where('status', '=', 'pending');
    const rows = await q.execute();
    res.json({ imports: rows.map(r => ({
      ...r,
      extracted_transactions: typeof r.extracted_transactions === 'string'
        ? JSON.parse(r.extracted_transactions) as unknown
        : r.extracted_transactions,
    })) });
  } catch (e) { next(e); }
});

const approveSchema = z.object({
  bank_account_id: z.string().uuid(),
  transactions: z.array(z.object({
    index: z.number().int().min(0),
    offset_account_id: z.string().uuid(),
    include: z.boolean().default(true),
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
      let posted = 0;

      await db.transaction().execute(async trx => {
        for (const item of included) {
          const tx = transactions[item.index];
          if (!tx) continue;

          const amt = parseFloat(tx.amount).toFixed(2);
          // For a bank account (asset, debit-normal):
          //   deposit (credit type = money in) → debit bank, credit offset
          //   withdrawal (debit type = money out) → credit bank, debit offset
          const isDeposit = tx.type === 'credit';

          const entryDate = (() => {
            const [m, d, y] = tx.date.split('/');
            return `${y}-${m?.padStart(2, '0')}-${d?.padStart(2, '0')}`;
          })();

          await postJournalEntry(trx, serviceCtx, {
            business_id: bizId,
            entry_date: entryDate,
            source_type: 'bank_import',
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
          });
          posted++;
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

      res.json({ ok: true, posted });
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
