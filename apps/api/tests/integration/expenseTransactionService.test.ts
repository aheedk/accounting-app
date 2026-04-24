import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeAccount, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as et from '../../src/services/ap/expenseTransactionService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

async function bootstrap() {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id);
  await grantAccess(t.db, user.id, biz.id);
  await seedCoa(t.db, biz.id);
  await seedYearPeriods(t.db, biz.id, 2026);
  const expense = await makeAccount(t.db, biz.id, { code: '6000', name: 'Office Supplies', account_type: 'expense' });
  const cash = await makeAccount(t.db, biz.id, { code: '1015', name: 'Cash', account_type: 'asset' });
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { firm, biz, user, ctx, expense, cash };
}

describe('expenseTransactionService', () => {
  it('createDraft inserts an expense transaction with status=draft and no JE', async () => {
    const { biz, ctx, expense, cash } = await bootstrap();
    const row = await t.db.transaction().execute(trx =>
      et.createDraft(trx, ctx, {
        business_id: biz.id, transaction_date: '2026-04-15',
        payee_text: 'Staples', expense_account_id: expense.id,
        payment_account_id: cash.id, amount: '42.50', memo: 'pens',
      }),
    );
    expect(row.status).toBe('draft');
    expect(row.journal_entry_id).toBeNull();
  });

  it('post creates a JE (DR expense / CR payment account) and links it', async () => {
    const { biz, ctx, expense, cash } = await bootstrap();
    const draft = await t.db.transaction().execute(trx =>
      et.createDraft(trx, ctx, {
        business_id: biz.id, transaction_date: '2026-04-15',
        payee_text: 'Staples', expense_account_id: expense.id,
        payment_account_id: cash.id, amount: '42.50',
      }),
    );
    const posted = await t.db.transaction().execute(trx =>
      et.post(trx, ctx, { expense_transaction_id: draft.id }),
    );
    expect(posted.status).toBe('posted');
    expect(posted.journal_entry_id).not.toBeNull();

    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', posted.journal_entry_id!).execute();
    expect(lines).toHaveLength(2);
    const dr = lines.find(l => l.account_id === expense.id);
    const cr = lines.find(l => l.account_id === cash.id);
    expect(dr?.debit).toBe('42.5000');
    expect(cr?.credit).toBe('42.5000');
  });

  it('void on a posted transaction reverses the JE and flips status', async () => {
    const { biz, ctx, expense, cash } = await bootstrap();
    const draft = await t.db.transaction().execute(trx =>
      et.createDraft(trx, ctx, {
        business_id: biz.id, transaction_date: '2026-04-15',
        payee_text: 'Staples', expense_account_id: expense.id,
        payment_account_id: cash.id, amount: '42.50',
      }),
    );
    const posted = await t.db.transaction().execute(trx =>
      et.post(trx, ctx, { expense_transaction_id: draft.id }),
    );
    const voided = await t.db.transaction().execute(trx =>
      et.voidExpense(trx, ctx, { expense_transaction_id: posted.id }),
    );
    expect(voided.status).toBe('void');
    expect(voided.voided_at).not.toBeNull();
    // Audit trail: void preserves the original JE link
    expect(voided.journal_entry_id).toBe(posted.journal_entry_id);
    expect(voided.posted_at).not.toBeNull();
  });
});
