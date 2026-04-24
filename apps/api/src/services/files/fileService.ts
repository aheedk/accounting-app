import { type Transaction, type Kysely } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { fileStorage } from '../../lib/fileStorage.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type UploadFileInput = {
  business_id: string;
  original_name: string;
  mime_type: string;
  buffer: Buffer;
};

export async function uploadFile(trx: Transaction<DB>, ctx: ServiceCtx, input: UploadFileInput) {
  const stored = await fileStorage.store(input.buffer, input.mime_type);
  const row = await trx.insertInto('files').values({
    business_id: input.business_id,
    original_name: input.original_name,
    mime_type: input.mime_type,
    byte_size: stored.byte_size,
    storage_path: stored.storage_path,
    uploaded_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.FILE_UPLOAD,
    entity_type: 'file',
    entity_id: row.id,
    before: null,
    after: { ...row, storage_path: '<redacted>' },
  });
  return row;
}

export async function getFileById(db: Kysely<DB>, business_id: string, id: string) {
  const row = await db.selectFrom('files').selectAll()
    .where('id', '=', id)
    .where('business_id', '=', business_id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('file', id);
  return row;
}

export async function streamFile(
  db: Kysely<DB>,
  business_id: string,
  id: string,
): Promise<{ row: Awaited<ReturnType<typeof getFileById>>; buffer: Buffer }> {
  const row = await getFileById(db, business_id, id);
  const buffer = await fileStorage.read(row.storage_path);
  return { row, buffer };
}
