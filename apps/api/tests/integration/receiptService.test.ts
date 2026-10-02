import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeFile } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as r from '../../src/services/accounting/receiptService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

async function bootstrap() {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id);
  await grantAccess(t.db, user.id, biz.id);
  const file = await makeFile(t.db, biz.id, user.id);
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { biz, user, file, ctx };
}

describe('receiptService', () => {
  it('createReceipt unlinked then linkReceipt to a fake bill works', async () => {
    const { biz, file, ctx } = await bootstrap();
    const created = await t.db.transaction().execute(trx =>
      r.createReceipt(trx, ctx, { business_id: biz.id, file_id: file.id }),
    );
    expect(created.linked_entity_type).toBe('unlinked');
    expect(created.linked_entity_id).toBeNull();

    const fakeBillId = '00000000-0000-0000-0000-000000000111';
    const linked = await t.db.transaction().execute(trx =>
      r.linkReceipt(trx, ctx, { receipt_id: created.id, linked_entity_type: 'bill', linked_entity_id: fakeBillId }),
    );
    expect(linked.linked_entity_type).toBe('bill');
    expect(linked.linked_entity_id).toBe(fakeBillId);

    const logs = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'receipt.link').execute();
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('lists the attachments of one transaction with their file names, and keeps tenants apart', async () => {
    const { biz, file, ctx } = await bootstrap();
    const expenseId = '00000000-0000-0000-0000-000000000222';
    const attached = await t.db.transaction().execute(trx => r.createReceipt(trx, ctx, {
      business_id: biz.id, file_id: file.id, linked_entity_type: 'expense_transaction', linked_entity_id: expenseId,
    }));
    await t.db.transaction().execute(trx => r.createReceipt(trx, ctx, { business_id: biz.id, file_id: file.id }));

    const list = await r.listReceipts(t.db, biz.id, { entity_type: 'expense_transaction', entity_id: expenseId });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: attached.id, file_name: file.original_name, file_mime_type: file.mime_type });

    // Another business can neither attach this file nor re-link this receipt.
    const other = await bootstrap();
    await expect(t.db.transaction().execute(trx =>
      r.createReceipt(trx, other.ctx, { business_id: other.biz.id, file_id: file.id }),
    )).rejects.toThrow(/not found/i);
    await expect(t.db.transaction().execute(trx =>
      r.linkReceipt(trx, other.ctx, { receipt_id: attached.id, linked_entity_type: 'unlinked', linked_entity_id: null }),
    )).rejects.toThrow(/not found/i);
  });

  it('linkReceipt back to unlinked clears the link and audit-logs UNLINK', async () => {
    const { biz, file, ctx } = await bootstrap();
    const created = await t.db.transaction().execute(trx =>
      r.createReceipt(trx, ctx, { business_id: biz.id, file_id: file.id, linked_entity_type: 'bill', linked_entity_id: '00000000-0000-0000-0000-000000000222' }),
    );
    const unlinked = await t.db.transaction().execute(trx =>
      r.linkReceipt(trx, ctx, { receipt_id: created.id, linked_entity_type: 'unlinked', linked_entity_id: null }),
    );
    expect(unlinked.linked_entity_type).toBe('unlinked');
    expect(unlinked.linked_entity_id).toBeNull();

    const logs = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'receipt.unlink').execute();
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});
