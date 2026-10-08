import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { refuseViewOnly } from '../middleware/rbac.js';
import * as messages from '../services/core/messageService.js';
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

// The company's thread. Open to everyone with access to the company, the client included.
router.get('/businesses/:businessId/messages', async (req, res, next) => {
  try {
    const q = schemas.messageListQuerySchema.parse(req.query);
    res.json(await messages.listMessages(db, { business_id: req.tenancy!.business_id, user_id: req.auth!.user_id, ...q }));
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/messages/unread-count', async (req, res, next) => {
  try {
    res.json({ count: await messages.unreadCount(db, { business_id: req.tenancy!.business_id, user_id: req.auth!.user_id }) });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/messages', refuseViewOnly, async (req, res, next) => {
  try {
    const body = schemas.messageCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      messages.postMessage(trx, ctxFromReq(req), { business_id: req.tenancy!.business_id, body: body.body }));
    res.status(201).json(created);
  } catch (e) { next(e); }
});

// Reading the thread changes nothing in the books, so a view-only login may mark it read too.
router.post('/businesses/:businessId/messages/read', async (req, res, next) => {
  try {
    await messages.markRead(db, { business_id: req.tenancy!.business_id, user_id: req.auth!.user_id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
