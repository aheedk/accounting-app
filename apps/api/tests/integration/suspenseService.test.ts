import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeAccount, makeBankAccount, makeBusiness, makeFirm, makeUser, seedYearPeriods } from '../helpers/factories.js';
import { getOrCreateSuspenseAccount } from '../../src/services/core/chartOfAccountsService.js';
import { listSuspenseItems, reclassifySuspenseItem, suspenseBalance } from '../../src/services/ai/suspenseService.js';
import { postStatementLines, normalizeCardLines, type StatementLine } from '../../src/services/ai/statementImportService.js';
import { suggestCoding } from '../../src/services/ai/autoCodingService.js';
import { closePeriod } from '../../src/services/core/periodCloseService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const business = await makeBusiness(t.db, firm.id, 'Suspense Biz');
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: business.id, effective_role: 'accountant',
    request_id: '00000000-0000-0000-0000-00000000ab17', ip_address: '127.0.0.1', user_agent: 'vitest',
  };
  await seedYearPeriods(t.db, business.id, 2026);
  const checking = await makeAccount(t.db, business.id, { code: '1010', name: 'Operating Checking', account_type: 'asset' });
  await makeBankAccount(t.db, business.id, checking.id);
  const card = await makeAccount(t.db, business.id, { code: '2100', name: 'Amex Gold', account_type: 'liability', detail_type: 'Credit Card' });
  const supplies = await makeAccount(t.db, business.id, { code: '6010', name: 'Office Supplies', account_type: 'expense' });
  const sales = await makeAccount(t.db, business.id, { code: '4000', name: 'Sales', account_type: 'revenue' });
  const suspense = await t.db.transaction().execute(trx => getOrCreateSuspenseAccount(trx, ctx, business.id));
  return { business, ctx, checking, card, supplies, sales, suspense };
}

const bankLines: StatementLine[] = [
  { date: '03/04/2026', description: 'ACH DEBIT MYSTERY CO 8812', amount: '120.00', type: 'expense' },
  { date: '03/06/2026', description: 'DEPOSIT REF 5521', amount: '900.00', type: 'deposit' },
];

describe('suspense', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('creates one Suspense account per client and keeps it out of the engine', async () => {
    const data = await setup(t);
    expect(data.suspense).toMatchObject({ code: '1999', name: 'Suspense', account_type: 'asset', detail_type: 'Suspense', is_system: true });
    const again = await t.db.transaction().execute(trx => getOrCreateSuspenseAccount(trx, data.ctx, data.business.id));
    expect(again.id).toBe(data.suspense.id);

    // The model naming "Suspense" is not a suggestion: unknown stays unknown.
    expect(await suggestCoding(t.db, data.ctx, {
      description: 'ACH DEBIT MYSTERY CO', amount: '10.00', direction: 'debit', ai_suggested_account: 'Suspense',
    })).toBeNull();

    const other = await makeBusiness(t.db, data.business.firm_id, 'Has 1999');
    await makeAccount(t.db, other.id, { code: '1999', name: 'Something else', account_type: 'asset' });
    const second = await t.db.transaction().execute(trx => getOrCreateSuspenseAccount(trx, { ...data.ctx, business_id: other.id }, other.id));
    expect(second.code).toBe('1998');
  });

  it('lists what is parked and clears it: an expense in place, a deposit by reclassification entry', async () => {
    const data = await setup(t);
    await t.db.transaction().execute(trx => postStatementLines(trx, data.ctx, {
      staging_id: randomUUID(), statement_kind: 'bank', lines: bankLines, account_id: data.checking.id,
      items: [
        { index: 0, offset_account_id: data.suspense.id },
        { index: 1, offset_account_id: data.suspense.id },
      ],
    }));

    const { items } = await listSuspenseItems(t.db, data.ctx);
    expect(items.map(i => [i.amount, i.direction, i.description])).toEqual([
      ['120.00', 'out', 'ACH DEBIT MYSTERY CO 8812'],
      ['900.00', 'in', 'DEPOSIT REF 5521'],
    ]);
    expect(items[0]!.bank_account_name).toBe('Operating Checking');
    expect(await suspenseBalance(t.db, data.business.id, '2026-03-31')).toBe('-780.00');

    const expense = await t.db.transaction().execute(trx => reclassifySuspenseItem(trx, data.ctx, {
      journal_entry_id: items[0]!.journal_entry_id, account_id: data.supplies.id, remember: true,
    }));
    expect(expense.method).toBe('edited');
    const line = await t.db.selectFrom('expense_transaction_lines as l')
      .innerJoin('expense_transactions as e', 'e.id', 'l.expense_transaction_id')
      .select('l.category_account_id').where('e.journal_entry_id', '=', expense.journal_entry_id)
      .executeTakeFirstOrThrow();
    expect(line.category_account_id).toBe(data.supplies.id);
    // "Remember" teaches the engine the vendor.
    expect(await suggestCoding(t.db, data.ctx, { description: 'ACH DEBIT MYSTERY CO 9001', amount: '50.00', direction: 'debit' }))
      .toMatchObject({ source_layer: 'learned_rule', lines: [{ account_id: data.supplies.id }] });

    const deposit = await t.db.transaction().execute(trx => reclassifySuspenseItem(trx, data.ctx, {
      journal_entry_id: items[1]!.journal_entry_id, account_id: data.sales.id,
    }));
    expect(deposit.method).toBe('journal_entry');
    expect((await listSuspenseItems(t.db, data.ctx)).items).toEqual([]);
    expect(await suspenseBalance(t.db, data.business.id, '2026-03-31')).toBe('0.00');
    const reclassLines = await t.db.selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit'])
      .where('journal_entry_id', '=', deposit.journal_entry_id).orderBy('line_number').execute();
    expect(reclassLines).toEqual([
      { account_id: data.sales.id, debit: '0.0000', credit: '900.0000' },
      { account_id: data.suspense.id, debit: '900.0000', credit: '0.0000' },
    ]);

    await expect(t.db.transaction().execute(trx => reclassifySuspenseItem(trx, data.ctx, {
      journal_entry_id: items[1]!.journal_entry_id, account_id: data.sales.id,
    }))).rejects.toThrow(/Nothing from this transaction/);
  });

  it('edits an imported card credit in place and refuses Suspense as the target', async () => {
    const data = await setup(t);
    const [credit] = await t.db.transaction().execute(trx => postStatementLines(trx, data.ctx, {
      staging_id: randomUUID(), statement_kind: 'credit_card',
      lines: normalizeCardLines([{ date: '03/09/2026', description: 'MERCHANT CREDIT 77', amount: '40.00', type: 'refund' }]),
      account_id: data.card.id,
      items: [{ index: 0, offset_account_id: data.suspense.id }],
    }));
    await expect(t.db.transaction().execute(trx => reclassifySuspenseItem(trx, data.ctx, {
      journal_entry_id: credit!, account_id: data.suspense.id,
    }))).rejects.toThrow(/not Suspense/);
    const result = await t.db.transaction().execute(trx => reclassifySuspenseItem(trx, data.ctx, {
      journal_entry_id: credit!, account_id: data.supplies.id,
    }));
    expect(result).toEqual({ method: 'edited', journal_entry_id: credit });
    expect((await listSuspenseItems(t.db, data.ctx)).items).toEqual([]);
  });

  it('will not close a period with a Suspense balance', async () => {
    const data = await setup(t);
    const [entry] = await t.db.transaction().execute(trx => postStatementLines(trx, data.ctx, {
      staging_id: randomUUID(), statement_kind: 'bank', lines: [bankLines[0]!], account_id: data.checking.id,
      items: [{ index: 0, offset_account_id: data.suspense.id }],
    }));
    const march = await t.db.selectFrom('fiscal_periods').select('id')
      .where('business_id', '=', data.business.id).where('starts_on', '=', '2026-03-01').executeTakeFirstOrThrow();
    await expect(t.db.transaction().execute(trx => closePeriod(trx, data.ctx, { period_id: march.id, memo: null })))
      .rejects.toThrow(/120.00 is still in Suspense/);

    await t.db.transaction().execute(trx => reclassifySuspenseItem(trx, data.ctx, { journal_entry_id: entry!, account_id: data.supplies.id }));
    const closed = await t.db.transaction().execute(trx => closePeriod(trx, data.ctx, { period_id: march.id, memo: null }));
    expect(closed.status).toBe('closed');
  });
});
