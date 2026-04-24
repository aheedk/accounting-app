import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, seedCoa, makeBankRule } from '../helpers/factories.js';
import * as bankRuleSvc from '../../src/services/banking/bankRuleService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb40', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'firm_admin' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin', ...meta };
  await seedCoa(t.db, biz.id);
  // 5500 Software Subscriptions (expense) — will be the offset account
  const software = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '5500').executeTakeFirstOrThrow();
  // 5600 Bank Fees (expense)
  const bankFees = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '5600').executeTakeFirstOrThrow();
  return { firm, biz, user, ctx, software, bankFees };
}

describe('bankRuleService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('createRule inserts a rule with the given offset account', async () => {
    const { biz, ctx, software } = await setup(t);
    const row = await t.db.transaction().execute(trx =>
      bankRuleSvc.createRule(trx, ctx, {
        business_id: biz.id,
        name: 'Stripe fees',
        description_contains: 'stripe',
        min_amount: null,
        max_amount: null,
        sign_filter: 'outflow_only',
        offset_account_id: software.id,
        priority: 100,
      }),
    );
    expect(row.name).toBe('Stripe fees');
    expect(row.description_contains).toBe('stripe');
    expect(row.sign_filter).toBe('outflow_only');
    expect(row.offset_account_id).toBe(software.id);
    expect(row.priority).toBe(100);
    expect(row.is_active).toBe(true);
    expect(row.deleted_at).toBeNull();

    const audit = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'bank_rule.create').execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.entity_id).toBe(row.id);
  });

  it('updateRule patches fields conditionally', async () => {
    const { biz, ctx, software } = await setup(t);
    const rule = await makeBankRule(t.db, biz.id, software.id, {
      name: 'Old name',
      description_contains: 'stripe',
    });

    const updated = await t.db.transaction().execute(trx =>
      bankRuleSvc.updateRule(trx, ctx, {
        rule_id: rule.id,
        patch: { name: 'New name', priority: 50 },
      }),
    );

    expect(updated.name).toBe('New name');
    expect(updated.priority).toBe(50);
    // Unchanged fields
    expect(updated.description_contains).toBe('stripe');
    expect(updated.offset_account_id).toBe(software.id);
    expect(updated.sign_filter).toBe('any');

    const audit = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'bank_rule.update').execute();
    expect(audit).toHaveLength(1);
  });

  it('listRules returns active rules sorted by priority', async () => {
    const { biz, software } = await setup(t);

    const r200 = await makeBankRule(t.db, biz.id, software.id, { name: 'Low priority' });
    await t.db.updateTable('bank_transaction_rules').set({ priority: 200 }).where('id', '=', r200.id).execute();

    const r100 = await makeBankRule(t.db, biz.id, software.id, { name: 'Mid priority' });
    await t.db.updateTable('bank_transaction_rules').set({ priority: 100 }).where('id', '=', r100.id).execute();

    const r50 = await makeBankRule(t.db, biz.id, software.id, { name: 'High priority' });
    await t.db.updateTable('bank_transaction_rules').set({ priority: 50 }).where('id', '=', r50.id).execute();

    // Soft-delete the mid-priority one
    await t.db.updateTable('bank_transaction_rules').set({ deleted_at: sql`now()` }).where('id', '=', r100.id).execute();

    const list = await bankRuleSvc.listRules(t.db, biz.id);
    expect(list).toHaveLength(2);
    expect(list[0]?.priority).toBe(50);
    expect(list[0]?.name).toBe('High priority');
    expect(list[1]?.priority).toBe(200);
    expect(list[1]?.name).toBe('Low priority');
    // Join exposes offset account code/name
    expect(list[0]?.offset_account_code).toBe('5500');
    expect(list[0]?.offset_account_name).toBe('Software Subscriptions');
  });
});
