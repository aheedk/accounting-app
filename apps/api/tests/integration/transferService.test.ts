import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeAccount, makeFirm, makeBusiness, makeUser, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import { createTransfer } from '../../src/services/banking/transferService.js';
import { describeTransactions } from '../../src/services/core/transactionDescriptorService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004011', ip_address: '127.0.0.1', user_agent: 'vitest' };

// 2026-09-28 audit: there was no Transfer transaction.
describe('transfers', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const account = (code: string) => t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', biz.id).where('code', '=', code).executeTakeFirstOrThrow();
    const savings = await makeAccount(t.db, biz.id, { code: '1030', name: 'Savings', account_type: 'asset', detail_type: 'Savings' });
    return { biz, ctx, checking: await account('1020'), rent: await account('5200'), savings };
  }

  it('moves money between two accounts as a journal entry labelled Transfer', async () => {
    const { biz, ctx, checking, savings } = await setup();
    const entry = await t.db.transaction().execute(trx => createTransfer(trx, ctx, {
      from_account_id: checking.id, to_account_id: savings.id, amount: '1500.00', transfer_date: '2026-04-15',
    }));

    const lines = await t.db.selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit'])
      .where('journal_entry_id', '=', entry.id).orderBy('line_number').execute();
    expect(lines.map(l => [l.account_id, l.debit, l.credit])).toEqual([
      [savings.id, '1500.0000', '0.0000'],     // money arrives
      [checking.id, '0.0000', '1500.0000'],    // money leaves
    ]);
    expect(entry).toMatchObject({ status: 'posted', memo: 'Transfer from Operating Bank Account to Savings' });

    const posted = await t.db.selectFrom('journal_entries')
      .select(['id', 'source_type', 'source_id', 'transaction_type', 'payee_name', 'reference', 'journal_number'])
      .where('id', '=', entry.id).where('business_id', '=', biz.id).executeTakeFirstOrThrow();
    const described = (await describeTransactions(t.db, [{
      ...posted, transaction_type: posted.transaction_type ?? null, payee_name: posted.payee_name ?? null,
    }])).get(entry.id);
    expect(described?.label).toBe('Transfer');
  });

  it('refuses the same account twice, an expense account, and an amount that is not above zero', async () => {
    const { ctx, checking, savings, rent } = await setup();
    const attempt = (patch: Partial<Parameters<typeof createTransfer>[2]>) =>
      t.db.transaction().execute(trx => createTransfer(trx, ctx, {
        from_account_id: checking.id, to_account_id: savings.id, amount: '100.00', transfer_date: '2026-04-15', ...patch,
      }));
    await expect(attempt({ to_account_id: checking.id })).rejects.toThrow(/two different accounts/);
    await expect(attempt({ to_account_id: rent.id })).rejects.toThrow(/income or expense account/);
    await expect(attempt({ amount: '0' })).rejects.toThrow(/above zero/);
  });
});
