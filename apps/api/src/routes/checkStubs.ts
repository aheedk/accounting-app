import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as stubs from '../services/ai/checkStubService.js';
import type { ServiceCtx } from '../lib/ctx.js';

// Check stubs uploaded to the AI inbox. Spec: docs/specs/2026-10-04-card-statements-and-check-stubs-design.md

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

router.get('/businesses/:businessId/check-stubs', async (req, res, next) => {
  try {
    res.json({ stubs: await stubs.listCheckStubs(db, ctxFromReq(req)) });
  } catch (e) { next(e); }
});

const applySchema = z.object({ category_account_id: z.string().uuid().nullable().optional() });

/** Fill in an already-posted check from its stub. */
router.post('/businesses/:businessId/check-stubs/:id/apply', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = applySchema.parse(req.body ?? {});
    const ctx = ctxFromReq(req);
    const result = await db.transaction().execute(trx => stubs.applyCheckStub(trx, ctx, {
      stub_id: req.params['id']!,
      category_account_id: body.category_account_id ?? null,
    }));
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/check-stubs/:id/dismiss', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const ctx = ctxFromReq(req);
    await db.transaction().execute(trx => stubs.dismissCheckStub(trx, ctx, req.params['id']!));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
