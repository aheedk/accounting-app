import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as inboxSvc from '../services/accounting/integrationInboxService.js';
import type { IntegrationInboxStatus, IntegrationSource } from '../db/types.js';
import type { ServiceCtx } from '../lib/ctx.js';

const router = Router({ mergeParams: true });

const INBOX_STATUSES: readonly IntegrationInboxStatus[] = [
  'pending', 'matched', 'categorized', 'excluded',
];
const INBOX_SOURCES: readonly IntegrationSource[] = [
  'stripe_csv', 'paypal_csv', 'shopify_csv', 'generic',
];

function ctxFromReq(req: Request): ServiceCtx {
  return {
    user_id: req.auth!.user_id, firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id, effective_role: req.tenancy!.effective_role,
    request_id: req.request_id, ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/integration-inbox', async (req, res, next) => {
  try {
    const opts: { status?: IntegrationInboxStatus; source?: IntegrationSource } = {};
    const status = req.query['status'];
    if (typeof status === 'string'
      && (INBOX_STATUSES as readonly string[]).includes(status)) {
      opts.status = status as IntegrationInboxStatus;
    }
    const source = req.query['source'];
    if (typeof source === 'string'
      && (INBOX_SOURCES as readonly string[]).includes(source)) {
      opts.source = source as IntegrationSource;
    }
    const rows = await inboxSvc.listInbox(db, req.tenancy!.business_id, opts);
    res.json({ integration_inbox: rows });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/integration-inbox/import', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.integrationInboxImportSchema.parse(req.body);
    const result = await db.transaction().execute(trx =>
      inboxSvc.importRows(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        source: body.source,
        rows: body.rows.map(r => {
          const row: inboxSvc.ImportRowInput = {
            occurred_at: r.occurred_at,
            description: r.description,
            amount: r.amount,
            external_id: r.external_id ?? null,
          };
          if (r.raw_payload !== undefined) row.raw_payload = r.raw_payload;
          return row;
        }),
      }),
    );
    res.status(201).json(result);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/integration-inbox/:id/match', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.integrationInboxMatchSchema.parse(req.body);
    const updated = await db.transaction().execute(trx =>
      inboxSvc.match(trx, ctxFromReq(req), {
        id: req.params['id']!,
        journal_entry_id: body.journal_entry_id,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/integration-inbox/:id/categorize', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.integrationInboxCategorizeSchema.parse(req.body);
    const updated = await db.transaction().execute(trx =>
      inboxSvc.categorize(trx, ctxFromReq(req), {
        id: req.params['id']!,
        cash_account_id: body.cash_account_id,
        offset_account_id: body.offset_account_id,
        memo: body.memo ?? null,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/integration-inbox/:id/exclude', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.integrationInboxExcludeSchema.parse(req.body);
    const updated = await db.transaction().execute(trx =>
      inboxSvc.exclude(trx, ctxFromReq(req), {
        id: req.params['id']!,
        excluded_reason: body.excluded_reason,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
