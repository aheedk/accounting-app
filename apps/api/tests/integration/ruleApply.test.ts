import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, seedCoa, seedYearPeriods, makeBankAccount, makeBankRule } from '../helpers/factories.js';
import * as btSvc from '../../src/services/banking/bankTransactionService.js';
import { applyRules, dryRunRule } from '../../src/services/banking/ruleApplyService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb50', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedCoa(t.db, biz.id);
  await seedYearPeriods(t.db, biz.id, 2026);
  const cash = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
  const revenue = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
  const expense = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '5010').executeTakeFirstOrThrow();
  const bankAccount = await makeBankAccount(t.db, biz.id, cash.id, { name: 'Primary' });
  return { firm, biz, user, ctx, cash, revenue, expense, bankAccount };
}

describe('ruleApplyService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('applyRules categorizes matching txns', async () => {
    const { biz, ctx, bankAccount, revenue } = await setup(t);

    // Create a rule matching 'stripe' (case-insensitive), routed to revenue
    await makeBankRule(t.db, biz.id, revenue.id, {
      name: 'Stripe payouts',
      description_contains: 'stripe',
    });

    // Import 3 txns: 2 match, 1 doesn't
    await t.db.transaction().execute(trx =>
      btSvc.importTransactions(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        rows: [
          { transaction_date: '2026-04-10', description: 'STRIPE payout 1200', amount: '1200.0000', external_id: 's1' },
          { transaction_date: '2026-04-11', description: 'Random 50', amount: '50.0000', external_id: 'r1' },
          { transaction_date: '2026-04-12', description: 'STRIPE refund 30', amount: '-30.0000', external_id: 's2' },
        ],
      }),
    );

    const result = await t.db.transaction().execute(trx =>
      applyRules(trx, ctx, { business_id: biz.id, bank_account_id: bankAccount.id }),
    );

    expect(result.applied).toBe(2);
    expect(result.rules_tried).toBe(1);

    const stripe1 = await t.db.selectFrom('bank_transactions').selectAll()
      .where('external_id', '=', 's1').executeTakeFirstOrThrow();
    expect(stripe1.status).toBe('categorized');
    expect(stripe1.matched_journal_entry_id).not.toBeNull();

    const random = await t.db.selectFrom('bank_transactions').selectAll()
      .where('external_id', '=', 'r1').executeTakeFirstOrThrow();
    expect(random.status).toBe('unreviewed');
    expect(random.matched_journal_entry_id).toBeNull();

    const stripe2 = await t.db.selectFrom('bank_transactions').selectAll()
      .where('external_id', '=', 's2').executeTakeFirstOrThrow();
    expect(stripe2.status).toBe('categorized');
    expect(stripe2.matched_journal_entry_id).not.toBeNull();

    const audit = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'bank_rule.apply').execute();
    expect(audit).toHaveLength(1);
  });

  it('applyRules respects priority order (first match wins)', async () => {
    const { biz, ctx, bankAccount, revenue, expense } = await setup(t);

    // Two rules that both match "stripe": priority 50 → revenue; priority 100 → expense
    await makeBankRule(t.db, biz.id, revenue.id, {
      name: 'Stripe (lower priority number = wins)',
      description_contains: 'stripe',
      priority: 50,
    });
    await makeBankRule(t.db, biz.id, expense.id, {
      name: 'Stripe (higher priority number)',
      description_contains: 'stripe',
      priority: 100,
    });

    await t.db.transaction().execute(trx =>
      btSvc.importTransactions(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        rows: [
          { transaction_date: '2026-04-10', description: 'Stripe 100', amount: '100.0000', external_id: 'p1' },
        ],
      }),
    );

    const result = await t.db.transaction().execute(trx =>
      applyRules(trx, ctx, { business_id: biz.id, bank_account_id: bankAccount.id }),
    );
    expect(result.applied).toBe(1);
    expect(result.rules_tried).toBe(2);

    const bt = await t.db.selectFrom('bank_transactions').selectAll()
      .where('external_id', '=', 'p1').executeTakeFirstOrThrow();
    expect(bt.status).toBe('categorized');
    expect(bt.matched_journal_entry_id).not.toBeNull();

    // Verify the JE has a line on the revenue account (lower-priority number rule won),
    // not the expense account.
    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', bt.matched_journal_entry_id!).execute();
    const accountIds = lines.map(l => l.account_id);
    expect(accountIds).toContain(revenue.id);
    expect(accountIds).not.toContain(expense.id);
  });

  it('dryRunRule reports match count and sample without mutating anything', async () => {
    const { biz, ctx, bankAccount } = await setup(t);
    await t.db.transaction().execute(trx =>
      btSvc.importTransactions(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        rows: [
          { transaction_date: '2026-04-10', description: 'STRIPE payout 1', amount: '90.0000', external_id: 'd-1' },
          { transaction_date: '2026-04-11', description: 'Stripe payout 2', amount: '450.0000', external_id: 'd-2' },
          { transaction_date: '2026-04-12', description: 'Office coffee', amount: '-6.0000', external_id: 'd-3' },
        ],
      }),
    );

    const result = await dryRunRule(t.db, biz.id, {
      description_contains: 'stripe',
      min_amount: '100',
      max_amount: null,
      sign_filter: 'inflow_only',
      bank_account_id: null,
    });
    expect(result.total_unreviewed).toBe(3);
    expect(result.matches).toBe(1);
    expect(result.sample).toHaveLength(1);
    expect(result.sample[0]?.description).toBe('Stripe payout 2');

    // Nothing mutated: all rows still unreviewed.
    const rows = await t.db.selectFrom('bank_transactions').selectAll()
      .where('business_id', '=', biz.id).execute();
    expect(rows.every(r => r.status === 'unreviewed')).toBe(true);
  });
});
