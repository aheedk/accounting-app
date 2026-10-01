import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeAccount, makeBusiness, makeFirm, makeUser, seedYearPeriods } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import * as imported from '../../src/services/banking/importedTransactionService.js';
import * as journalQueries from '../../src/services/core/journalEntryQueryService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const IMPORT_ID = '22222222-2222-4222-8222-222222222222';

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const business = await makeBusiness(t.db, firm.id, 'Imported Txn Biz');
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: business.id, effective_role: 'accountant',
    request_id: '00000000-0000-0000-0000-00000000ab13', ip_address: '127.0.0.1', user_agent: 'vitest',
  };
  await seedYearPeriods(t.db, business.id, 2026);
  const checking = await makeAccount(t.db, business.id, { code: '1010', name: 'Checking', account_type: 'asset' });
  const savings = await makeAccount(t.db, business.id, { code: '1020', name: 'Savings', account_type: 'asset' });
  const supplies = await makeAccount(t.db, business.id, { code: '6010', name: 'Supplies', account_type: 'expense' });
  const rent = await makeAccount(t.db, business.id, { code: '6020', name: 'Rent', account_type: 'expense' });
  return { business, ctx, checking, savings, supplies, rent };
}

async function postCheck(t: TestDb, data: Awaited<ReturnType<typeof setup>>) {
  return t.db.transaction().execute(trx => ledger.postJournalEntry(trx, data.ctx, {
    business_id: data.business.id,
    entry_date: '2026-04-15',
    source_type: 'bank_import',
    source_id: IMPORT_ID,
    transaction_type: 'check',
    payee_name: 'Staples',
    reference: '1042',
    memo: 'CHECK 1042',
    lines: [
      { account_id: data.checking.id, debit: '0.0000', credit: '75.0000', memo: 'CHECK 1042' },
      { account_id: data.supplies.id, debit: '75.0000', credit: '0.0000', memo: 'CHECK 1042' },
    ],
  }));
}

describe('importedTransactionService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('reads an imported check as an editable transaction and links the journal entry to it', async () => {
    const data = await setup(t);
    const entry = await postCheck(t, data);

    const txn = await imported.getImportedTransaction(t.db, data.ctx, entry.id);
    expect(txn).toMatchObject({
      transaction_type: 'check', direction: 'out', payee_name: 'Staples', check_number: '1042',
      bank_account_id: data.checking.id, category_account_id: data.supplies.id,
      amount: '75.0000', can_edit: true,
    });

    const detail = await journalQueries.getJournalEntryDetail(t.db, data.ctx, entry.id);
    expect(detail.source_path).toBe(`/transactions/${entry.id}`);
  });

  it('edits payee, date, bank, category, amount and check number in place', async () => {
    const data = await setup(t);
    const entry = await postCheck(t, data);

    const updated = await t.db.transaction().execute(trx => imported.updateImportedTransaction(trx, data.ctx, {
      journal_entry_id: entry.id,
      entry_date: '2026-05-02',
      transaction_type: 'check',
      payee_name: 'Landlord LLC',
      check_number: '2001',
      memo: 'May rent',
      bank_account_id: data.savings.id,
      category_account_id: data.rent.id,
      amount: '1200.00',
    }));

    expect(updated).toMatchObject({
      id: entry.id, entry_date: '2026-05-02', payee_name: 'Landlord LLC', check_number: '2001',
      memo: 'May rent', bank_account_id: data.savings.id, category_account_id: data.rent.id,
      amount: '1200.0000',
    });
    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', entry.id).orderBy('line_number').execute();
    expect(lines.map(l => [l.account_id, l.debit, l.credit])).toEqual([
      [data.savings.id, '0.0000', '1200.0000'],
      [data.rent.id, '1200.0000', '0.0000'],
    ]);
    const row = await t.db.selectFrom('journal_entries').selectAll()
      .where('id', '=', entry.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ source_type: 'bank_import', source_id: IMPORT_ID, status: 'posted' });
  });

  it('clears the check number when a check becomes an expense, and refuses to flip direction', async () => {
    const data = await setup(t);
    const entry = await postCheck(t, data);
    const base = {
      journal_entry_id: entry.id, entry_date: '2026-04-15', payee_name: 'Staples', check_number: '1042',
      memo: null, bank_account_id: data.checking.id, category_account_id: data.supplies.id, amount: '75.00',
    };

    const asExpense = await t.db.transaction().execute(trx =>
      imported.updateImportedTransaction(trx, data.ctx, { ...base, transaction_type: 'expense' }));
    expect(asExpense).toMatchObject({ transaction_type: 'expense', check_number: null });

    await expect(t.db.transaction().execute(trx =>
      imported.updateImportedTransaction(trx, data.ctx, { ...base, transaction_type: 'deposit' }),
    )).rejects.toThrow(/cannot be changed into a deposit/);

    await expect(t.db.transaction().execute(trx =>
      imported.updateImportedTransaction(trx, data.ctx, {
        ...base, transaction_type: 'expense', category_account_id: data.checking.id,
      }),
    )).rejects.toThrow(/different accounts/);
  });

  it('blocks staff from editing', async () => {
    const data = await setup(t);
    const entry = await postCheck(t, data);
    const staff = { ...data.ctx, effective_role: 'staff' as const };

    const txn = await imported.getImportedTransaction(t.db, staff, entry.id);
    expect(txn.can_edit).toBe(false);
    await expect(t.db.transaction().execute(trx => imported.updateImportedTransaction(trx, staff, {
      journal_entry_id: entry.id, entry_date: '2026-04-15', transaction_type: 'check',
      bank_account_id: data.checking.id, category_account_id: data.supplies.id, amount: '75.00',
    }))).rejects.toThrow(/Accountant access/);
  });
});
