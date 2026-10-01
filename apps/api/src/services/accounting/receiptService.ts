import { type Transaction, type Kysely } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB, ReceiptLinkedEntityType } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateReceiptInput = {
  business_id: string;
  file_id: string;
  linked_entity_type?: ReceiptLinkedEntityType;
  linked_entity_id?: string | null;
};

export async function createReceipt(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateReceiptInput) {
  const linkType = input.linked_entity_type ?? 'unlinked';
  const linkId = linkType === 'unlinked' ? null : (input.linked_entity_id ?? null);
  // The file id comes from the client: it must be one of this business's files.
  const file = await trx.selectFrom('files').select('id')
    .where('id', '=', input.file_id)
    .where('business_id', '=', input.business_id)
    .executeTakeFirst();
  if (!file) throw new NotFoundError('file', input.file_id);
  const row = await trx.insertInto('receipts').values({
    business_id: input.business_id,
    file_id: input.file_id,
    uploaded_by_user_id: ctx.user_id,
    linked_entity_type: linkType,
    linked_entity_id: linkId,
  }).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.RECEIPT_CREATE,
    entity_type: 'receipt',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function linkReceipt(trx: Transaction<DB>, ctx: ServiceCtx, input: {
  receipt_id: string;
  linked_entity_type: ReceiptLinkedEntityType;
  linked_entity_id: string | null;
}) {
  // Scoped to the caller's business so a receipt id from another tenant is "not found".
  const before = await trx.selectFrom('receipts').selectAll()
    .where('id', '=', input.receipt_id)
    .where('business_id', '=', ctx.business_id)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('receipt', input.receipt_id);

  const newType = input.linked_entity_type;
  const newId = newType === 'unlinked' ? null : input.linked_entity_id;
  const updated = await trx.updateTable('receipts').set({
    linked_entity_type: newType,
    linked_entity_id: newId,
  }).where('id', '=', input.receipt_id).returningAll().executeTakeFirstOrThrow();

  const action = newType === 'unlinked' ? AUDIT.RECEIPT_UNLINK : AUDIT.RECEIPT_LINK;
  await auditRecord(trx, ctx, {
    action,
    entity_type: 'receipt',
    entity_id: updated.id,
    before,
    after: updated,
  });
  return updated;
}

export async function listReceipts(
  db: Kysely<DB>,
  business_id: string,
  opts: { entity_type?: ReceiptLinkedEntityType; entity_id?: string } = {},
) {
  // File name, type and size ride along so attachment lists need no second request.
  let q = db.selectFrom('receipts as r')
    .innerJoin('files as f', 'f.id', 'r.file_id')
    .selectAll('r')
    .select(['f.original_name as file_name', 'f.mime_type as file_mime_type', 'f.byte_size as file_byte_size'])
    .where('r.business_id', '=', business_id);
  if (opts.entity_type) q = q.where('r.linked_entity_type', '=', opts.entity_type);
  if (opts.entity_id) q = q.where('r.linked_entity_id', '=', opts.entity_id);
  return q.orderBy('r.created_at', 'desc').execute();
}
