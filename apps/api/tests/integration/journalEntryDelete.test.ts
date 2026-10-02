import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeAccount, makeBusiness, makeFile, makeFirm, makeUser, seedYearPeriods } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import * as periods from '../../src/services/core/fiscalPeriodService.js';
import * as expenses from '../../src/services/ap/expenseTransactionService.js';
import * as receipts from '../../src/services/accounting/receiptService.js';
import * as journalQueries from '../../src/services/core/journalEntryQueryService.js';
import * as reportService from '../../src/services/reports/generalLedgerService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const business = await makeBusiness(t.db, firm.id, 'Delete JE Biz');
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: business.id, effective_role: 'accountant',
    request_id: '00000000-0000-0000-0000-00000000ab14', ip_address: '127.0.0.1', user_agent: 'vitest',
  };
  await seedYearPeriods(t.db, business.id, 2026);
  const cash = await makeAccount(t.db, business.id, { code: '1010', name: 'Cash', account_type: 'asset' });
  const revenue = await makeAccount(t.db, business.id, { code: '4010', name: 'Sales', account_type: 'revenue' });
  const supplies = await makeAccount(t.db, business.id, { code: '6010', name: 'Supplies', account_type: 'expense' });
  return { business, user, ctx, cash, revenue, supplies };
}

async function postManual(t: TestDb, data: Awaited<ReturnType<typeof setup>>, entryDate = '2026-04-15') {
  return t.db.transaction().execute(trx => ledger.postJournalEntry(trx, data.ctx, {
    business_id: data.business.id, entry_date: entryDate, source_type: 'manual', memo: 'Hand-entered',
    lines: [
      { account_id: data.cash.id, debit: '100.0000', credit: '0.0000', memo: null },
      { account_id: data.revenue.id, debit: '0.0000', credit: '100.0000', memo: null },
    ],
  }));
}

const entryCount = async (t: TestDb) => Number((await t.db.selectFrom('journal_entries')
  .select(({ fn }) => fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);

describe('deleting journal entries', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('removes a posted manual entry from the books and keeps a copy in the audit log', async () => {
    const data = await setup(t);
    const entry = await postManual(t, data);
    const file = await makeFile(t.db, data.business.id, data.user.id);
    const receipt = await t.db.transaction().execute(trx => receipts.createReceipt(trx, data.ctx, {
      business_id: data.business.id, file_id: file.id, linked_entity_type: 'journal_entry', linked_entity_id: entry.id,
    }));

    const detail = await journalQueries.getJournalEntryDetail(t.db, data.ctx, entry.id);
    expect(detail).toMatchObject({ can_delete: true, delete_block_reason: null, delete_removes_pair: false });

    const result = await t.db.transaction().execute(trx =>
      ledger.deleteJournalEntry(trx, data.ctx, { journal_entry_id: entry.id }));
    expect(result.deleted_entry_ids).toEqual([entry.id]);
    expect(await entryCount(t)).toBe(0);
    const orphanLines = await t.db.selectFrom('journal_entry_lines').select('id')
      .where('journal_entry_id', '=', entry.id).execute();
    expect(orphanLines).toHaveLength(0);

    const report = await reportService.generalLedger(t.db, {
      business_id: data.business.id, period_start: '2026-01-01', period_end: '2026-12-31',
    });
    expect(report.accounts).toHaveLength(0);

    const log = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'journal_entry.delete').executeTakeFirstOrThrow();
    expect(log.entity_id).toBe(entry.id);
    expect(JSON.stringify(log.before_state)).toContain('Hand-entered');

    // The attached file survives as an unlinked receipt.
    const kept = await t.db.selectFrom('receipts').selectAll().where('id', '=', receipt.id).executeTakeFirstOrThrow();
    expect(kept).toMatchObject({ linked_entity_type: 'unlinked', linked_entity_id: null });
  });

  it('deletes a voided entry and its reversal together, from either one', async () => {
    const data = await setup(t);
    const first = await postManual(t, data);
    const firstReversal = await t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, data.ctx, {
      journal_entry_id: first.id, void_reason: 'Entered twice', reversal_date: first.entry_date,
    }));
    const detail = await journalQueries.getJournalEntryDetail(t.db, data.ctx, first.id);
    expect(detail).toMatchObject({ can_delete: true, delete_removes_pair: true });

    await t.db.transaction().execute(trx => ledger.deleteJournalEntry(trx, data.ctx, { journal_entry_id: first.id }));
    expect(await entryCount(t)).toBe(0);
    expect(firstReversal.reversed_entry_id).toBe(first.id);

    // Same result when the reversal is the one that gets deleted.
    const second = await postManual(t, data);
    const secondReversal = await t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, data.ctx, {
      journal_entry_id: second.id, void_reason: 'Entered twice', reversal_date: second.entry_date,
    }));
    await t.db.transaction().execute(trx =>
      ledger.deleteJournalEntry(trx, data.ctx, { journal_entry_id: secondReversal.id }));
    expect(await entryCount(t)).toBe(0);
  });

  it('undoes a standalone reversal, and refuses to delete a reversed entry out from under it', async () => {
    const data = await setup(t);
    const entry = await postManual(t, data);
    const reversal = await t.db.transaction().execute(trx =>
      ledger.reverseJournalEntry(trx, data.ctx, { journal_entry_id: entry.id }));

    await expect(t.db.transaction().execute(trx =>
      ledger.deleteJournalEntry(trx, data.ctx, { journal_entry_id: entry.id }),
    )).rejects.toThrow(/Delete the reversing entry first/);

    await t.db.transaction().execute(trx =>
      ledger.deleteJournalEntry(trx, data.ctx, { journal_entry_id: reversal.id }));
    const remaining = await t.db.selectFrom('journal_entries').select(['id', 'status']).execute();
    expect(remaining).toEqual([{ id: entry.id, status: 'posted' }]);
  });

  it('refuses source-generated entries, closed periods, staff, and other tenants', async () => {
    const data = await setup(t);
    const expense = await t.db.transaction().execute(trx => expenses.createExpense(trx, data.ctx, {
      transaction_date: '2026-04-15', payee_text: 'Staples',
      payment_account_id: data.cash.id, payment_method: 'other',
      lines: [{ category_account_id: data.supplies.id, amount: '40.00' }],
    }));
    await expect(t.db.transaction().execute(trx =>
      ledger.deleteJournalEntry(trx, data.ctx, { journal_entry_id: expense.journal_entry_id! }),
    )).rejects.toThrow(/source transaction/);

    const entry = await postManual(t, data);
    await expect(t.db.transaction().execute(trx =>
      ledger.deleteJournalEntry(trx, { ...data.ctx, effective_role: 'staff' }, { journal_entry_id: entry.id }),
    )).rejects.toThrow(/Accountant access/);

    const other = await setup(t);
    await expect(t.db.transaction().execute(trx =>
      ledger.deleteJournalEntry(trx, other.ctx, { journal_entry_id: entry.id }),
    )).rejects.toThrow(/not found/);

    const april = await t.db.selectFrom('fiscal_periods').select('id')
      .where('business_id', '=', data.business.id).where('starts_on', '=', '2026-04-01').executeTakeFirstOrThrow();
    await t.db.transaction().execute(trx =>
      periods.closePeriod(trx, { ...data.ctx, effective_role: 'firm_admin' }, { period_id: april.id }));
    await expect(t.db.transaction().execute(trx =>
      ledger.deleteJournalEntry(trx, data.ctx, { journal_entry_id: entry.id }),
    )).rejects.toThrow(/closed accounting period/);
    const detail = await journalQueries.getJournalEntryDetail(t.db, data.ctx, entry.id);
    expect(detail.can_delete).toBe(false);
  });
});
