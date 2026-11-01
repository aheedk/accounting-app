import { Router } from 'express';
import type { Request } from 'express';
import type { Transaction } from 'kysely';
import type { ZodType, ZodTypeDef } from 'zod';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import type { ServiceCtx } from '../lib/ctx.js';
import { importCheck, listBatches, runQbImport, undoAll, undoBatch, type QbImportResult } from '../services/import/qbBatches.js';
import { importAccounts, importCustomers, importItems, importVendors } from '../services/import/qbLists.js';
import { importOpenBills, importOpenInvoices } from '../services/import/qbOpenItems.js';
import { importHistory, importTrialBalance, importUncleared } from '../services/import/qbLedger.js';

// Setup -> Import from QuickBooks. Every upload can be tried first with
// ?dry_run=true: it runs in full and is rolled back, so the preview is what
// posting would do. An upload with any problem posts nothing.
// Spec: docs/specs/2026-10-28-quickbooks-import-design.md.

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

const MAX_PROBLEMS = 200;

function step<T>(
  path: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  fn: (trx: Transaction<DB>, ctx: ServiceCtx, input: T) => Promise<QbImportResult>,
) {
  router.post(`/businesses/:businessId/qb-import/${path}`, requireMinRole('accountant'), async (req, res, next) => {
    try {
      const input = schema.parse(req.body);
      const dryRun = req.query['dry_run'] === 'true';
      const ctx = ctxFromReq(req);
      const result = await runQbImport(db, trx => fn(trx, ctx, input), dryRun);
      const more = result.problems.length - MAX_PROBLEMS;
      const problems = more > 0
        ? [...result.problems.slice(0, MAX_PROBLEMS), { row: null, message: `and ${more} more` }]
        : result.problems;
      res.status(!dryRun && result.problems.length > 0 ? 422 : 200).json({ ...result, problems, dry_run: dryRun });
    } catch (e) { next(e); }
  });
}

router.get('/businesses/:businessId/qb-import', async (req, res, next) => {
  try { res.json(await listBatches(db, req.tenancy!.business_id)); }
  catch (e) { next(e); }
});

router.get('/businesses/:businessId/qb-import/check', async (req, res, next) => {
  try { res.json(await importCheck(db, req.tenancy!.business_id)); }
  catch (e) { next(e); }
});

step('accounts', schemas.qbAccountsImportSchema, importAccounts);
step('customers', schemas.qbCustomersImportSchema, importCustomers);
step('vendors', schemas.qbVendorsImportSchema, importVendors);
step('items', schemas.qbItemsImportSchema, importItems);
step('open-invoices', schemas.qbOpenInvoicesImportSchema, importOpenInvoices);
step('open-bills', schemas.qbOpenBillsImportSchema, importOpenBills);
step('uncleared', schemas.qbUnclearedImportSchema, importUncleared);
step('history', schemas.qbHistoryImportSchema, importHistory);
step('trial-balance', schemas.qbTrialBalanceImportSchema, importTrialBalance);

router.post('/businesses/:businessId/qb-import/batches/:batchId/undo', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const batchId = String(req.params['batchId']);
    const undone = await db.transaction().execute(trx => undoBatch(trx, ctxFromReq(req), batchId));
    res.json({ batch: undone });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/qb-import/undo-all', requireMinRole('accountant'), async (req, res, next) => {
  try { res.json(await db.transaction().execute(trx => undoAll(trx, ctxFromReq(req)))); }
  catch (e) { next(e); }
});

export default router;
