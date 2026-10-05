import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import { listSuspenseItems, reclassifySuspenseItem } from '../services/ai/suspenseService.js';
import type { ServiceCtx } from '../lib/ctx.js';

// What the AI parked in Suspense. Spec: docs/specs/2026-10-04-suspense-account-design.md

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

router.get('/businesses/:businessId/suspense', async (req, res, next) => {
  try {
    res.json(await listSuspenseItems(db, ctxFromReq(req)));
  } catch (e) { next(e); }
});

/** Move one transaction's Suspense amount to the account it belongs in. */
router.post('/businesses/:businessId/suspense/:journalEntryId/reclassify', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.suspenseReclassifySchema.parse(req.body ?? {});
    const ctx = ctxFromReq(req);
    const result = await db.transaction().execute(trx => reclassifySuspenseItem(trx, ctx, {
      journal_entry_id: req.params['journalEntryId']!,
      account_id: body.account_id,
      ...(body.remember !== undefined ? { remember: body.remember } : {}),
    }));
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
