import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as btSvc from '../services/banking/bankTransactionService.js';
import type { BankTransactionStatus } from '../db/types.js';
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

router.get('/businesses/:businessId/bank-transactions', async (req, res, next) => {
  try {
    const q: {
      business_id: string;
      bank_account_id?: string;
      status?: BankTransactionStatus;
      is_reconciled?: boolean;
    } = { business_id: req.tenancy!.business_id };
    const bankAccountId = req.query['bank_account_id'];
    if (typeof bankAccountId === 'string') q.bank_account_id = bankAccountId;
    const status = req.query['status'];
    if (typeof status === 'string' && ['unreviewed', 'matched', 'categorized', 'excluded'].includes(status)) {
      q.status = status as BankTransactionStatus;
    }
    const isRecon = req.query['is_reconciled'];
    if (typeof isRecon === 'string') q.is_reconciled = isRecon === 'true';

    const list = await btSvc.listTransactions(db, q);
    res.json({ bank_transactions: list });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/bank-transactions/:id', async (req, res, next) => {
  try {
    res.json(await btSvc.getTransaction(db, req.tenancy!.business_id, req.params['id']!));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-transactions/import', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.bankTransactionImportSchema.parse(req.body);
    const result = await db.transaction().execute(trx =>
      btSvc.importTransactions(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        bank_account_id: body.bank_account_id,
        rows: body.rows.map(r => ({
          transaction_date: r.transaction_date,
          description: r.description,
          amount: r.amount,
          external_id: r.external_id ?? null,
        })),
      }),
    );
    res.status(201).json(result);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-transactions/:id/match', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.bankTransactionMatchSchema.parse(req.body);
    const updated = await db.transaction().execute(trx =>
      btSvc.match(trx, ctxFromReq(req), {
        bank_transaction_id: req.params['id']!,
        journal_entry_id: body.journal_entry_id,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-transactions/:id/categorize', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.bankTransactionCategorizeSchema.parse(req.body);
    const updated = await db.transaction().execute(trx =>
      btSvc.categorize(trx, ctxFromReq(req), {
        bank_transaction_id: req.params['id']!,
        offset_account_id: body.offset_account_id,
        memo: body.memo ?? null,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-transactions/:id/exclude', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.bankTransactionExcludeSchema.parse(req.body);
    const updated = await db.transaction().execute(trx =>
      btSvc.exclude(trx, ctxFromReq(req), {
        bank_transaction_id: req.params['id']!,
        excluded_reason: body.excluded_reason,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-transactions/:id/unreview', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const updated = await db.transaction().execute(trx =>
      btSvc.unreview(trx, ctxFromReq(req), { bank_transaction_id: req.params['id']! }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
