import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, seedCoa, seedYearPeriods, makeBankAccount } from '../helpers/factories.js';
import * as btSvc from '../../src/services/banking/bankTransactionService.js';
import { postJournalEntry } from '../../src/services/core/ledgerService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb40', ip_address: '127.0.0.1', user_agent: 'vitest' };

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

describe('bankTransactionService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('importTransactions inserts rows with status=unreviewed, dedupes by external_id', async () => {
    const { biz, ctx, bankAccount } = await setup(t);
    const first = await t.db.transaction().execute(trx =>
      btSvc.importTransactions(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        rows: [
          { transaction_date: '2026-04-10', description: 'Deposit A', amount: '100.0000', external_id: 'ext-1' },
          { transaction_date: '2026-04-11', description: 'Coffee', amount: '-4.2500', external_id: 'ext-2' },
          { transaction_date: '2026-04-12', description: 'No-ext row', amount: '25.0000', external_id: null },
        ],
      }),
    );
    expect(first.imported).toBe(3);
    expect(first.deduped).toBe(0);

    // Re-import with same external_ids should dedupe and only insert new ones
    const second = await t.db.transaction().execute(trx =>
      btSvc.importTransactions(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        rows: [
          { transaction_date: '2026-04-10', description: 'Deposit A', amount: '100.0000', external_id: 'ext-1' },
          { transaction_date: '2026-04-12', description: 'New row', amount: '10.0000', external_id: 'ext-3' },
        ],
      }),
    );
    expect(second.imported).toBe(1);
    expect(second.deduped).toBe(1);

    const rows = await t.db.selectFrom('bank_transactions').selectAll().where('bank_account_id', '=', bankAccount.id).execute();
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.status).toBe('unreviewed');
      expect(r.is_reconciled).toBe(false);
    }

    const audit = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'bank_transaction.import').execute();
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('matchToJournalEntry flips status to matched, links the JE id', async () => {
    const { biz, ctx, bankAccount, cash, revenue } = await setup(t);
    // Import a row
    await t.db.transaction().execute(trx =>
      btSvc.importTransactions(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        rows: [{ transaction_date: '2026-04-10', description: 'Paid invoice 123', amount: '500.0000', external_id: 'p1' }],
      }),
    );
    const bt = await t.db.selectFrom('bank_transactions').selectAll().where('external_id', '=', 'p1').executeTakeFirstOrThrow();

    // Create an existing posted JE that represents this cash event
    const je = await t.db.transaction().execute(trx =>
      postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-04-10',
        source_type: 'manual',
        memo: 'Invoice receipt',
        lines: [
          { account_id: cash.id,    debit: '500.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000',   credit: '500.0000', memo: null },
        ],
      }),
    );

    const updated = await t.db.transaction().execute(trx =>
      btSvc.match(trx, ctx, { bank_transaction_id: bt.id, journal_entry_id: je.id }),
    );
    expect(updated.status).toBe('matched');
    expect(updated.matched_journal_entry_id).toBe(je.id);
    expect(updated.reviewed_at).not.toBeNull();
    expect(updated.reviewed_by_user_id).toBe(ctx.user_id);
  });

  it('categorize creates a new JE (DR Cash / CR offset for inflow) and links it', async () => {
    const { biz, ctx, bankAccount, cash, revenue } = await setup(t);
    await t.db.transaction().execute(trx =>
      btSvc.importTransactions(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        rows: [{ transaction_date: '2026-04-10', description: 'Consulting fee', amount: '250.0000', external_id: 'c1' }],
      }),
    );
    const bt = await t.db.selectFrom('bank_transactions').selectAll().where('external_id', '=', 'c1').executeTakeFirstOrThrow();

    const updated = await t.db.transaction().execute(trx =>
      btSvc.categorize(trx, ctx, {
        bank_transaction_id: bt.id,
        offset_account_id: revenue.id,
        memo: 'Categorize to revenue',
      }),
    );
    expect(updated.status).toBe('categorized');
    expect(updated.matched_journal_entry_id).toBeTruthy();

    const je = await t.db.selectFrom('journal_entries').selectAll()
      .where('id', '=', updated.matched_journal_entry_id!).executeTakeFirstOrThrow();
    expect(je.status).toBe('posted');
    expect(je.source_type).toBe('manual');

    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', je.id).orderBy('line_number').execute();
    const cashLine = lines.find(l => l.account_id === cash.id)!;
    const revLine  = lines.find(l => l.account_id === revenue.id)!;
    expect(cashLine.debit).toBe('250.0000');
    expect(cashLine.credit).toBe('0.0000');
    expect(revLine.credit).toBe('250.0000');
    expect(revLine.debit).toBe('0.0000');
  });

  it('exclude flips status to excluded with a reason', async () => {
    const { biz, ctx, bankAccount } = await setup(t);
    await t.db.transaction().execute(trx =>
      btSvc.importTransactions(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        rows: [{ transaction_date: '2026-04-10', description: 'Transfer out', amount: '-100.0000', external_id: 'x1' }],
      }),
    );
    const bt = await t.db.selectFrom('bank_transactions').selectAll().where('external_id', '=', 'x1').executeTakeFirstOrThrow();
    const updated = await t.db.transaction().execute(trx =>
      btSvc.exclude(trx, ctx, { bank_transaction_id: bt.id, excluded_reason: 'Transfer between own accounts' }),
    );
    expect(updated.status).toBe('excluded');
    expect(updated.excluded_reason).toBe('Transfer between own accounts');
    expect(updated.matched_journal_entry_id).toBeNull();
  });

  it('unreview from any terminal state rolls back to unreviewed and clears links', async () => {
    const { biz, ctx, bankAccount, revenue } = await setup(t);
    await t.db.transaction().execute(trx =>
      btSvc.importTransactions(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        rows: [{ transaction_date: '2026-04-10', description: 'Payment', amount: '80.0000', external_id: 'u1' }],
      }),
    );
    const bt = await t.db.selectFrom('bank_transactions').selectAll().where('external_id', '=', 'u1').executeTakeFirstOrThrow();

    // Categorize first
    const cat = await t.db.transaction().execute(trx =>
      btSvc.categorize(trx, ctx, {
        bank_transaction_id: bt.id,
        offset_account_id: revenue.id,
        memo: null,
      }),
    );
    expect(cat.status).toBe('categorized');

    // Now unreview
    const cleared = await t.db.transaction().execute(trx =>
      btSvc.unreview(trx, ctx, { bank_transaction_id: bt.id }),
    );
    expect(cleared.status).toBe('unreviewed');
    expect(cleared.matched_journal_entry_id).toBeNull();
    expect(cleared.excluded_reason).toBeNull();
    expect(cleared.reviewed_at).toBeNull();
    expect(cleared.reviewed_by_user_id).toBeNull();
  });
});
