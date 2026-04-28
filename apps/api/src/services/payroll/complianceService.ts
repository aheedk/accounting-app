import { type Transaction, type Kysely } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB, ComplianceItemStatus } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export async function listForBusiness(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('compliance_items').selectAll()
    .where('business_id', '=', business_id)
    .orderBy('item_key').execute();
}

export async function update(trx: Transaction<DB>, ctx: ServiceCtx, input: {
  item_id: string;
  patch: {
    status?: ComplianceItemStatus;
    due_date?: string | null;
    notes?: string | null;
    document_file_id?: string | null;
  };
}) {
  const before = await trx.selectFrom('compliance_items').selectAll()
    .where('id', '=', input.item_id).executeTakeFirst();
  if (!before) throw new NotFoundError('compliance_item', input.item_id);

  const updated = await trx.updateTable('compliance_items').set({
    ...(input.patch.status !== undefined ? { status: input.patch.status } : {}),
    ...(input.patch.due_date !== undefined ? { due_date: input.patch.due_date } : {}),
    ...(input.patch.notes !== undefined ? { notes: input.patch.notes } : {}),
    ...(input.patch.document_file_id !== undefined ? { document_file_id: input.patch.document_file_id } : {}),
  }).where('id', '=', input.item_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.COMPLIANCE_ITEM_UPDATE,
    entity_type: 'compliance_item', entity_id: updated.id,
    before, after: updated,
  });
  return updated;
}
