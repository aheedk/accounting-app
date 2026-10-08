import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import * as approvals from '../services/core/approvalService.js';
import type { ServiceCtx } from '../lib/ctx.js';

/**
 * Holds a staff login's entry for approval when its company asks for that.
 *
 * Mounted once in app.ts on `/businesses/:businessId`, after the business is
 * resolved and before every router, so the routes themselves are untouched:
 * an accountant's request passes straight through to them, and so does a staff
 * login's in a company that has not switched approval on. Only what is listed
 * in approvalService.HELD_ACTIONS is ever held: the entries that would be in
 * the books the moment they were saved.
 *
 * The answer is 202 with `pending_approval: true`. Nothing has been recorded.
 */
export async function holdStaffEntries(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.tenancy?.effective_role !== 'staff') return next();
    const found = approvals.findHeldAction(req.method, req.path);
    if (!found) return next();
    if (!(await approvals.needsApproval(db, req.tenancy.business_id))) return next();

    // Checked now with the route's own schema, so a mistake is the staff
    // member's to fix today and not the accountant's to find tomorrow.
    found.held.schema.parse(req.body);

    const ctx: ServiceCtx = {
      user_id: req.auth!.user_id, firm_id: req.auth!.firm_id,
      business_id: req.tenancy.business_id, effective_role: req.tenancy.effective_role,
      request_id: req.request_id, ip_address: req.ip ?? '0.0.0.0',
      user_agent: req.header('user-agent') ?? '',
    };
    const described = await found.held.describe(db, req.tenancy.business_id, found.record_id, req.body as Record<string, unknown>);
    const row = await db.transaction().execute(trx => approvals.createRequest(trx, ctx, {
      business_id: req.tenancy!.business_id,
      action: found.held.action,
      method: req.method.toUpperCase(),
      path: req.path,
      // As it was sent, so approving it does what saving it would have done.
      payload: req.body,
      ...described,
    }));
    res.status(202).json({
      pending_approval: true,
      approval_id: row.id,
      message: 'Sent for approval. It will be recorded once an accountant approves it.',
    });
  } catch (err) { next(err); }
}
