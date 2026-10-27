import { Router, type Request } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { refuseViewOnly } from '../middleware/rbac.js';
import { ERR, schemas } from '@accounting/shared';
import { BusinessRuleError } from '../lib/errors.js';
import { RateLimit } from '../lib/rateLimit.js';
import { handleChatMessage } from '../services/ai/chatService.js';

const router = Router({ mergeParams: true });

// 20 messages/minute/user, per the brief's own rate-limit requirement — same
// RateLimit class ai.ts's document-upload limit uses, a different instance/key.
export const CHAT_MESSAGES_PER_MINUTE = 20;
export const chatMessages = new RateLimit(CHAT_MESSAGES_PER_MINUTE, 60_000);

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

// Not reachable by a `client` login: chat isn't in clientAccess.ts's
// allow-list (apps/api/src/lib/clientAccess.ts), so the tenancy middleware
// refuses it before this file ever runs — deliberate. The chat feature's
// text-to-SQL reaches across the whole business's ledger, not the narrow,
// already-filtered slice (own invoices/bills/messages) a client is normally
// scoped to, so it stays closed to that role rather than added to the list.

router.get('/businesses/:businessId/chat/conversations', async (req, res, next) => {
  try {
    const conversations = await db.selectFrom('chat_conversations')
      .selectAll()
      .where('business_id', '=', req.tenancy!.business_id)
      .where('user_id', '=', req.auth!.user_id)
      .orderBy('updated_at', 'desc')
      .limit(50)
      .execute();
    res.json({ conversations });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/chat/conversations/:id/messages', async (req, res, next) => {
  try {
    const conversation = await db.selectFrom('chat_conversations').selectAll()
      .where('id', '=', req.params['id']!)
      .where('business_id', '=', req.tenancy!.business_id)
      .where('user_id', '=', req.auth!.user_id)
      .executeTakeFirst();
    if (!conversation) { res.status(404).json({ error: { code: ERR.NOT_FOUND, message: 'conversation not found' } }); return; }
    const messages = await db.selectFrom('chat_messages')
      .selectAll()
      .where('conversation_id', '=', conversation.id)
      .orderBy('created_at', 'asc')
      .execute();
    res.json({ conversation, messages });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/chat', refuseViewOnly, async (req: Request, res, next) => {
  try {
    const wait = chatMessages.take(req.auth!.user_id);
    if (wait !== null) {
      throw new BusinessRuleError(ERR.RATE_LIMITED, `Too many messages sent. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
    }
    const body = schemas.chatMessageRequestSchema.parse(req.body);
    const result = await handleChatMessage(
      db,
      { business_id: req.tenancy!.business_id, user_id: req.auth!.user_id },
      { message: body.message, ...(body.conversationId !== undefined ? { conversationId: body.conversationId } : {}) },
    );
    res.json({
      reply: result.reply,
      conversationId: result.conversationId,
      ...(result.action !== undefined ? { action: result.action } : {}),
      ...(result.data !== undefined ? { data: result.data } : {}),
    });
  } catch (e) { next(e); }
});

export default router;
