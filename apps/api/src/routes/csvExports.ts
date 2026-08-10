import { Router } from 'express';
import { z } from 'zod';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import * as csv from '../services/reports/csvExportService.js';

const router = Router({ mergeParams: true });
router.use('/businesses/:businessId', requireAuth, resolveBusiness);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const trialBalanceQuery = z.object({ as_of: dateSchema });
const journalEntriesQuery = z.object({ from: dateSchema, to: dateSchema });

router.get('/businesses/:businessId/csv-exports/trial-balance', async (req, res, next) => {
  try {
    const q = trialBalanceQuery.parse({ as_of: req.query['as_of'] });
    const file = await csv.exportTrialBalance(db, req.tenancy!.business_id, q.as_of);
    res.setHeader('Content-Type', file.content_type);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    res.setHeader('Content-Length', String(file.body.length));
    res.end(file.body);
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/csv-exports/journal-entries', async (req, res, next) => {
  try {
    const q = journalEntriesQuery.parse({ from: req.query['from'], to: req.query['to'] });
    const file = await csv.exportJournalEntryLines(db, req.tenancy!.business_id, q.from, q.to);
    res.setHeader('Content-Type', file.content_type);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    res.setHeader('Content-Length', String(file.body.length));
    res.end(file.body);
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/csv-exports/general-ledger', async (req, res, next) => {
  try {
    const q = schemas.generalLedgerQuerySchema.parse({
      period_start: req.query['period_start'],
      period_end: req.query['period_end'],
      ...(typeof req.query['account_id'] === 'string' ? { account_id: req.query['account_id'] } : {}),
    });
    const file = await csv.exportGeneralLedger(
      db,
      req.tenancy!.business_id,
      q.period_start,
      q.period_end,
      q.account_id,
    );
    res.setHeader('Content-Type', file.content_type);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    res.setHeader('Content-Length', String(file.body.length));
    res.end(file.body);
  } catch (e) { next(e); }
});

export default router;
