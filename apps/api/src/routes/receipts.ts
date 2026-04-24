import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as receiptSvc from '../services/accounting/receiptService.js';
import type { ReceiptLinkedEntityType } from '../db/types.js';
import type { ServiceCtx } from '../lib/ctx.js';

const router = Router({ mergeParams: true });

const RECEIPT_LINKED_ENTITY_TYPES: readonly ReceiptLinkedEntityType[] = [
  'bank_transaction', 'bill', 'expense_transaction', 'invoice', 'journal_entry', 'unlinked',
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

router.get('/businesses/:businessId/receipts', async (req, res, next) => {
  try {
    const opts: { entity_type?: ReceiptLinkedEntityType; entity_id?: string } = {};
    const entityType = req.query['entity_type'];
    if (typeof entityType === 'string'
      && (RECEIPT_LINKED_ENTITY_TYPES as readonly string[]).includes(entityType)) {
      opts.entity_type = entityType as ReceiptLinkedEntityType;
    }
    const entityId = req.query['entity_id'];
    if (typeof entityId === 'string') opts.entity_id = entityId;

    const receipts = await receiptSvc.listReceipts(db, req.tenancy!.business_id, opts);
    res.json({ receipts });
  } catch (e) { next(e); }
});

// receiptLinkSchema is a ZodEffects (has .refine), so build a small create-schema inline.
const receiptCreateSchema = z.object({
  file_id: z.string().uuid(),
  linked_entity_type: z.enum([
    'bank_transaction', 'bill', 'expense_transaction', 'invoice', 'journal_entry', 'unlinked',
  ]).optional(),
  linked_entity_id: z.string().uuid().nullable().optional(),
}).refine(
  v => {
    const t = v.linked_entity_type ?? 'unlinked';
    return (t === 'unlinked') === (v.linked_entity_id == null);
  },
  { message: 'unlinked requires null linked_entity_id; linked types require a uuid' },
);

router.post('/businesses/:businessId/receipts', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = receiptCreateSchema.parse(req.body);
    const input: receiptSvc.CreateReceiptInput = {
      business_id: req.tenancy!.business_id,
      file_id: body.file_id,
    };
    if (body.linked_entity_type !== undefined) input.linked_entity_type = body.linked_entity_type;
    if (body.linked_entity_id !== undefined) input.linked_entity_id = body.linked_entity_id ?? null;

    const created = await db.transaction().execute(trx =>
      receiptSvc.createReceipt(trx, ctxFromReq(req), input),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/receipts/:id/link', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.receiptLinkSchema.parse(req.body);
    const updated = await db.transaction().execute(trx =>
      receiptSvc.linkReceipt(trx, ctxFromReq(req), {
        receipt_id: req.params['id']!,
        linked_entity_type: body.linked_entity_type,
        linked_entity_id: body.linked_entity_id ?? null,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
