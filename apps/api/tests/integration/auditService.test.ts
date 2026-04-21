// apps/api/tests/integration/auditService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeUser } from '../helpers/factories.js';
import { record } from '../../src/services/audit/auditService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

describe('auditService', () => {
  let t: TestDb;

  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('writes a row in the same transaction', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id);
    const ctx: ServiceCtx = {
      user_id: user.id, firm_id: firm.id, business_id: null,
      effective_role: 'accountant', request_id: '00000000-0000-0000-0000-000000000001',
      ip_address: '127.0.0.1', user_agent: 'vitest',
    };
    await t.db.transaction().execute(async (trx) => {
      await record(trx, ctx, {
        action: 'auth.login',
        entity_type: 'user',
        entity_id: user.id,
        before: null,
        after: { email: user.email },
      });
    });
    const rows = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('auth.login');
    expect(rows[0]!.entity_id).toBe(user.id);
  });

  it('rolls back audit row if caller transaction rolls back', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id);
    const ctx: ServiceCtx = {
      user_id: user.id, firm_id: firm.id, business_id: null,
      effective_role: 'accountant', request_id: '00000000-0000-0000-0000-000000000002',
      ip_address: '127.0.0.1', user_agent: 'vitest',
    };
    await expect(t.db.transaction().execute(async (trx) => {
      await record(trx, ctx, {
        action: 'auth.login', entity_type: 'user', entity_id: user.id,
        before: null, after: { email: user.email },
      });
      throw new Error('boom');
    })).rejects.toThrow('boom');
    const rows = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('audit_logs is append-only (UPDATE raises)', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id);
    const ctx: ServiceCtx = {
      user_id: user.id, firm_id: firm.id, business_id: null,
      effective_role: 'accountant', request_id: '00000000-0000-0000-0000-000000000003',
      ip_address: '127.0.0.1', user_agent: 'vitest',
    };
    await t.db.transaction().execute(async (trx) => {
      await record(trx, ctx, { action: 'auth.login', entity_type: 'user', entity_id: user.id, before: null, after: null });
    });
    await expect(
      t.db.updateTable('audit_logs').set({ action: 'auth.logout' }).execute()
    ).rejects.toThrow(/append-only/i);
  });
});
