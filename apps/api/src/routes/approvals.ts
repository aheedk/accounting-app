import { Router } from 'express';
import type { Request } from 'express';
import { hasMinRole, schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as approvals from '../services/core/approvalService.js';
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

// An accountant sees everything waiting, and so does a view-only login (it reads
// what there is to read); staff see what they themselves sent, and what became of it.
router.get('/businesses/:businessId/approvals', requireMinRole('viewer'), async (req, res, next) => {
  try {
    const q = schemas.approvalListQuerySchema.parse(req.query);
    const reviewer = hasMinRole(req.tenancy!.effective_role, 'accountant') || req.tenancy!.effective_role === 'viewer';
    const requests = await approvals.listRequests(db, {
      business_id: req.tenancy!.business_id,
      status: q.status,
      limit: q.limit,
      ...(reviewer ? {} : { requested_by: req.auth!.user_id }),
    });
    res.json({ requests, needs_approval: await approvals.needsApproval(db, req.tenancy!.business_id) });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/approvals/pending-count', requireMinRole('accountant'), async (req, res, next) => {
  try { res.json({ count: await approvals.pendingCount(db, req.tenancy!.business_id) }); }
  catch (e) { next(e); }
});

/**
 * Approving records the entry: the held request is sent again, to this same
 * server, as the accountant. It therefore goes through the route it was meant
 * for, with every check that route makes, and is recorded by the service that
 * always records it. If that refuses (a closed period, say), the request stays
 * waiting and the accountant is told why.
 */
router.post('/businesses/:businessId/approvals/:approvalId/approve', requireMinRole('accountant'), async (req, res, next) => {
  const business_id = req.tenancy!.business_id;
  let claimedId: string | null = null;
  try {
    const request = await approvals.claimForApproval(db, { id: req.params['approvalId']!, business_id });
    claimedId = request.id;
    const payload = typeof request.payload === 'string' ? request.payload : JSON.stringify(request.payload);
    const response = await fetch(`http://localhost:${req.socket.localPort}/businesses/${business_id}${request.path}`, {
      method: request.method,
      headers: { 'content-type': 'application/json', authorization: req.header('authorization') ?? '' },
      body: payload,
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      await approvals.releaseClaim(db, request.id);
      claimedId = null;
      res.status(response.status).json(result ?? { error: { code: 'INTERNAL', message: 'It could not be recorded.' } });
      return;
    }
    const approved = await db.transaction().execute(trx => approvals.finishApproval(trx, ctxFromReq(req), { id: request.id, result }));
    claimedId = null;
    res.json({ id: approved.id, status: approved.status, result });
  } catch (e) {
    // Never leave it stuck mid-approval.
    if (claimedId) await approvals.releaseClaim(db, claimedId).catch(() => undefined);
    next(e);
  }
});

router.post('/businesses/:businessId/approvals/:approvalId/reject', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.approvalRejectSchema.parse(req.body);
    const rejected = await db.transaction().execute(trx => approvals.rejectRequest(trx, ctxFromReq(req), {
      id: req.params['approvalId']!, business_id: req.tenancy!.business_id, note: body.note ?? null,
    }));
    res.json({ id: rejected.id, status: rejected.status });
  } catch (e) { next(e); }
});

export default router;
