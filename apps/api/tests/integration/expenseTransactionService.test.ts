import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeAccount, makeVendor, makeCustomer, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as et from '../../src/services/ap/expenseTransactionService.js';
import * as ledger from '../../src/services/core/ledgerService.js';

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
  const supplies = await makeAccount(t.db, biz.id, { code: '6000', name: 'Office Supplies', account_type: 'expense' });
  const rent = await makeAccount(t.db, biz.id, { code: '6010', name: 'Rent', account_type: 'expense' });
  const cash = await makeAccount(t.db, biz.id, { code: '1015', name: 'Cash', account_type: 'asset' });
  const creditCard = await makeAccount(t.db, biz.id, { code: '2015', name: 'Business Credit Card', account_type: 'liability' });
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { firm, biz, user, ctx, supplies, rent, cash, creditCard };
}

describe('expenseTransactionService', () => {
  it('createExpense posts a balanced JE (debit each line, credit the payment account) and sets the total', async () => {
    const { biz, ctx, supplies, rent, cash } = await bootstrap();
    const expense = await t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15',
      payee_text: 'Staples',
      payment_account_id: cash.id,
      payment_method: 'cash',
      memo: 'Office run',
      lines: [
        { category_account_id: supplies.id, amount: '30.00', description: 'Pens' },
        { category_account_id: rent.id, amount: '12.50' },
      ],
    }));

    expect(expense.status).toBe('posted');
    expect(expense.total_amount).toBe('42.5000');
    expect(expense.journal_entry_id).toBeTruthy();

    const entry = await t.db.selectFrom('journal_entries').selectAll()
      .where('id', '=', expense.journal_entry_id!).executeTakeFirstOrThrow();
    expect(entry.source_type).toBe('expense');
    expect(entry.source_id).toBe(expense.id);

    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', expense.journal_entry_id!).execute();
    expect(lines).toHaveLength(3);
    const dr1 = lines.find(l => l.account_id === supplies.id);
    const dr2 = lines.find(l => l.account_id === rent.id);
    const cr = lines.find(l => l.account_id === cash.id);
    expect(dr1?.debit).toBe('30.0000');
    expect(dr2?.debit).toBe('12.5000');
    expect(cr?.credit).toBe('42.5000');

    const audit = await t.db.selectFrom('audit_logs').selectAll()
      .where('business_id', '=', biz.id).where('action', '=', 'expense_transaction.create').execute();
    expect(audit).toHaveLength(1);
  });

  it('accepts a vendor or a customer as payee, but not both', async () => {
    const { biz, ctx, supplies, cash } = await bootstrap();
    const vendor = await makeVendor(t.db, biz.id);
    const customer = await makeCustomer(t.db, biz.id);

    const viaVendor = await t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', vendor_id: vendor.id,
      payment_account_id: cash.id, payment_method: 'check',
      lines: [{ category_account_id: supplies.id, amount: '10.00' }],
    }));
    expect(viaVendor.vendor_id).toBe(vendor.id);

    await expect(t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', vendor_id: vendor.id, customer_id: customer.id,
      payment_account_id: cash.id, payment_method: 'check',
      lines: [{ category_account_id: supplies.id, amount: '10.00' }],
    }))).rejects.toThrow(/pick one payee/i);

    await expect(t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15',
      payment_account_id: cash.id, payment_method: 'check',
      lines: [{ category_account_id: supplies.id, amount: '10.00' }],
    }))).rejects.toThrow(/payee is required/i);
  });

  it('allows a credit-card (liability) payment account, same as cash', async () => {
    const { ctx, supplies, creditCard } = await bootstrap();
    const expense = await t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', payee_text: 'Amazon',
      payment_account_id: creditCard.id, payment_method: 'credit_card',
      lines: [{ category_account_id: supplies.id, amount: '19.99' }],
    }));
    expect(expense.payment_account_id).toBe(creditCard.id);
  });

  it('rejects a line that uses the payment account as its own category', async () => {
    const { ctx, cash } = await bootstrap();
    await expect(t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', payee_text: 'Staples',
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: cash.id, amount: '10.00' }],
    }))).rejects.toThrow(/same account as the payment account/);
  });

  it('rejects a zero or negative total', async () => {
    const { ctx, supplies, cash } = await bootstrap();
    await expect(t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', payee_text: 'Staples',
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: supplies.id, amount: '0' }],
    }))).rejects.toThrow(/greater than zero/);
  });

  it('updateExpense voids the old JE and posts a replacement with the new lines', async () => {
    const { supplies, rent, cash, ctx } = await bootstrap();
    const expense = await t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', payee_text: 'Staples',
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: supplies.id, amount: '30.00' }],
    }));
    const originalJeId = expense.journal_entry_id!;

    const updated = await t.db.transaction().execute(trx => et.updateExpense(trx, ctx, expense.id, {
      transaction_date: '2026-04-16', payee_text: 'Staples',
      payment_account_id: cash.id, payment_method: 'check', reference: '2001',
      lines: [{ category_account_id: rent.id, amount: '55.00' }],
    }));

    expect(updated.total_amount).toBe('55.0000');
    expect(updated.reference).toBe('2001');
    expect(updated.journal_entry_id).not.toBe(originalJeId);

    const originalJe = await t.db.selectFrom('journal_entries').select('status')
      .where('id', '=', originalJeId).executeTakeFirstOrThrow();
    expect(originalJe.status).toBe('voided');

    // The reversal of the OLD JE reverses on the OLD transaction date
    // (2026-04-15), not the new one (2026-04-16) and not today.
    const reversal = await t.db.selectFrom('journal_entries').selectAll()
      .where('reversed_entry_id', '=', originalJeId).executeTakeFirstOrThrow();
    expect(reversal.entry_date).toBe('2026-04-15');

    const newLines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', updated.journal_entry_id!).execute();
    expect(newLines.find(l => l.account_id === rent.id)?.debit).toBe('55.0000');

    const linesOnFile = await t.db.selectFrom('expense_transaction_lines').selectAll()
      .where('expense_transaction_id', '=', expense.id).execute();
    expect(linesOnFile).toHaveLength(1);
    expect(linesOnFile[0]!.category_account_id).toBe(rent.id);
  });

  it('voidExpense reverses the JE, flips status, and blocks a second void', async () => {
    const { supplies, cash, ctx } = await bootstrap();
    const expense = await t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', payee_text: 'Staples',
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: supplies.id, amount: '30.00' }],
    }));
    const voided = await t.db.transaction().execute(trx =>
      et.voidExpense(trx, ctx, { expense_transaction_id: expense.id }));
    expect(voided.status).toBe('void');
    expect(voided.voided_at).not.toBeNull();
    // Audit trail: void preserves the original JE link.
    expect(voided.journal_entry_id).toBe(expense.journal_entry_id);

    const je = await t.db.selectFrom('journal_entries').select('status')
      .where('id', '=', expense.journal_entry_id!).executeTakeFirstOrThrow();
    expect(je.status).toBe('voided');

    // voidJournalEntry defaults reversal_date to today when omitted — without
    // passing transaction_date explicitly this would land on today instead of
    // 2026-04-15, leaving the voided original's amount unoffset in any GL view
    // bounded to its own period (exactly the bug reported against deposits).
    const reversal = await t.db.selectFrom('journal_entries').selectAll()
      .where('reversed_entry_id', '=', expense.journal_entry_id!).executeTakeFirstOrThrow();
    expect(reversal.entry_date).toBe('2026-04-15');

    await expect(t.db.transaction().execute(trx =>
      et.voidExpense(trx, ctx, { expense_transaction_id: expense.id }),
    )).rejects.toThrow(/already void/);
  });

  it('a voided expense cannot be edited', async () => {
    const { supplies, rent, cash, ctx } = await bootstrap();
    const expense = await t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', payee_text: 'Staples',
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: supplies.id, amount: '30.00' }],
    }));
    await t.db.transaction().execute(trx => et.voidExpense(trx, ctx, { expense_transaction_id: expense.id }));

    await expect(t.db.transaction().execute(trx => et.updateExpense(trx, ctx, expense.id, {
      transaction_date: '2026-04-16', payee_text: 'Staples',
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: rent.id, amount: '10.00' }],
    }))).rejects.toThrow(/voided expense cannot be edited/);
  });

  it('deleteExpense removes the row AND the JE entirely — nothing left in the General Ledger', async () => {
    const { supplies, cash, ctx } = await bootstrap();
    const expense = await t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', payee_text: 'Staples',
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: supplies.id, amount: '30.00' }],
    }));
    const jeId = expense.journal_entry_id!;

    await t.db.transaction().execute(trx => et.deleteExpense(trx, ctx, expense.id));

    const row = await t.db.selectFrom('expense_transactions').select('id')
      .where('id', '=', expense.id).executeTakeFirst();
    expect(row).toBeUndefined();

    // Delete is a true QBO-style hard delete — unlike voidExpense, which
    // keeps the JE (voided) plus a reversal, nothing is left behind here.
    const je = await t.db.selectFrom('journal_entries').select('id')
      .where('id', '=', jeId).executeTakeFirst();
    expect(je).toBeUndefined();
    const reversal = await t.db.selectFrom('journal_entries').select('id')
      .where('reversed_entry_id', '=', jeId).executeTakeFirst();
    expect(reversal).toBeUndefined();

    const audit = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'expense_transaction.delete').execute();
    expect(audit).toHaveLength(1);
  });

  it('refuses to delete an expense whose JE has been reconciled', async () => {
    const { biz, supplies, cash, ctx } = await bootstrap();
    const expense = await t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', payee_text: 'Staples',
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: supplies.id, amount: '30.00' }],
    }));

    // Simulate the expense's cash line having been matched + reconciled via the bank feed.
    await t.db.insertInto('bank_transactions').values({
      business_id: biz.id,
      bank_account_id: (await t.db.insertInto('bank_accounts').values({
        business_id: biz.id, cash_account_id: cash.id, name: 'Checking',
      }).returning('id').executeTakeFirstOrThrow()).id,
      transaction_date: '2026-04-15',
      description: 'Staples',
      amount: '-30.00',
      status: 'matched',
      matched_journal_entry_id: expense.journal_entry_id,
      is_reconciled: true,
      reviewed_at: new Date(),
    }).execute();

    await expect(t.db.transaction().execute(trx =>
      et.deleteExpense(trx, ctx, expense.id),
    )).rejects.toThrow(/reconciled and cannot be deleted/);
  });

  it('getExpense reports is_reconciled and editable', async () => {
    const { supplies, cash, ctx } = await bootstrap();
    const expense = await t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', payee_text: 'Staples',
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: supplies.id, amount: '30.00' }],
    }));
    const fetched = await et.getExpense(t.db, ctx, expense.id);
    expect(fetched.is_reconciled).toBe(false);
    expect(fetched.editable).toBe(true);
    expect(fetched.payee_name).toBe('Staples');
    expect(fetched.lines).toHaveLength(1);

    await t.db.transaction().execute(trx => et.voidExpense(trx, ctx, { expense_transaction_id: expense.id }));
    const afterVoid = await et.getExpense(t.db, ctx, expense.id);
    expect(afterVoid.editable).toBe(false);
  });

  it('listExpenses returns every expense for the business, newest first', async () => {
    const { supplies, cash, ctx } = await bootstrap();
    await t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-01', payee_text: 'Older',
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: supplies.id, amount: '10.00' }],
    }));
    await t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', payee_text: 'Newer',
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: supplies.id, amount: '20.00' }],
    }));

    const rows = await et.listExpenses(t.db, ctx);
    expect(rows.map(r => r.payee_name)).toEqual(['Newer', 'Older']);
  });

  it('isSourceGeneratedJournalEntry protects an expense JE without a source_guard', async () => {
    const { supplies, cash, ctx } = await bootstrap();
    const expense = await t.db.transaction().execute(trx => et.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', payee_text: 'Staples',
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: supplies.id, amount: '30.00' }],
    }));
    await expect(t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: expense.journal_entry_id!,
      void_reason: 'should be blocked',
    }))).rejects.toThrow(/source transaction/);
  });

  it('voids, edits, and deletes a legacy expense whose JE still carries source_type=adjustment', async () => {
    // je_protect_posted_row() treats source_type as permanent identity on a
    // posted JE, so rows created before the dedicated 'expense' type existed
    // can never be migrated to it — they stay 'adjustment' forever. voidGuardFor
    // must echo that back, not assume every expense JE says 'expense'.
    const { biz, supplies, rent, cash, ctx } = await bootstrap();
    const legacy = await t.db.transaction().execute(async trx => {
      const row = await trx.insertInto('expense_transactions').values({
        business_id: biz.id, transaction_date: '2026-03-01', payee_text: 'Old Vendor',
        payment_account_id: cash.id, payment_method: 'other', total_amount: '15.00',
      }).returningAll().executeTakeFirstOrThrow();
      const je = await ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-03-01', source_type: 'adjustment', source_id: row.id,
        memo: 'Legacy expense', lines: [
          { account_id: supplies.id, debit: '15.00', credit: '0', memo: null },
          { account_id: cash.id, debit: '0', credit: '15.00', memo: null },
        ],
      });
      await trx.insertInto('expense_transaction_lines').values({
        expense_transaction_id: row.id, business_id: biz.id, category_account_id: supplies.id, amount: '15.00',
      }).execute();
      return trx.updateTable('expense_transactions')
        .set({ status: 'posted', journal_entry_id: je.id, posted_at: new Date() })
        .where('id', '=', row.id).returningAll().executeTakeFirstOrThrow();
    });
    expect(legacy.journal_entry_id).toBeTruthy();

    const updated = await t.db.transaction().execute(trx => et.updateExpense(trx, ctx, legacy.id, {
      transaction_date: '2026-03-02', payee_text: 'Old Vendor',
      payment_account_id: cash.id, payment_method: 'other',
      lines: [{ category_account_id: rent.id, amount: '20.00' }],
    }));
    expect(updated.total_amount).toBe('20.0000');
    const oldJe = await t.db.selectFrom('journal_entries').select('status')
      .where('id', '=', legacy.journal_entry_id!).executeTakeFirstOrThrow();
    expect(oldJe.status).toBe('voided');

    const voided = await t.db.transaction().execute(trx =>
      et.voidExpense(trx, ctx, { expense_transaction_id: legacy.id }));
    expect(voided.status).toBe('void');

    await t.db.transaction().execute(trx => et.deleteExpense(trx, ctx, legacy.id));
    const row = await t.db.selectFrom('expense_transactions').select('id')
      .where('id', '=', legacy.id).executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it('wrapImportedExpenseJournalEntry produces an expense that is still fully editable, voidable, and deletable', async () => {
    const { biz, supplies, cash, ctx } = await bootstrap();

    const je = await t.db.transaction().execute(async trx => {
      const posted = await trx.insertInto('journal_entries').values({
        business_id: biz.id,
        period_id: (await trx.selectFrom('fiscal_periods').select('id').where('business_id', '=', biz.id).where('starts_on', '<=', '2026-03-07').where('ends_on', '>=', '2026-03-07').executeTakeFirstOrThrow()).id,
        entry_date: '2026-03-07',
        journal_number: 'IMPORT-1',
        memo: 'IRS USATAXPYMT',
        status: 'draft',
        source_type: 'bank_import',
        // Real imports always set a staging-row source_id (see emailImports.ts);
        // only a non-null source_id lets voidGuardFor authorize the edit below.
        source_id: '00000000-0000-0000-0000-000000000001',
        transaction_type: 'expense',
        payee_name: 'IRS',
        created_by_user_id: ctx.user_id,
      }).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto('journal_entry_lines').values([
        { journal_entry_id: posted.id, line_number: 1, account_id: cash.id, debit: '0', credit: '690.20', memo: null },
        { journal_entry_id: posted.id, line_number: 2, account_id: supplies.id, debit: '690.20', credit: '0', memo: null },
      ]).execute();
      return trx.updateTable('journal_entries').set({ status: 'posted', posted_at: sql`now()` }).where('id', '=', posted.id).returningAll().executeTakeFirstOrThrow();
    });

    const wrapped = await t.db.transaction().execute(trx => et.wrapImportedExpenseJournalEntry(trx, ctx, {
      journal_entry_id: je.id,
      payment_account_id: cash.id,
      category_account_id: supplies.id,
      payment_method: 'other',
      entry_date: '2026-03-07',
      description: 'IRS USATAXPYMT',
      payee_name: 'IRS',
      amount: '690.20',
    }));
    expect(wrapped).not.toBeNull();

    // imported=true still marks its provenance (drives the "Imported" badge),
    // but — same as Bank Deposits — it does not block editing, voiding, or deleting.
    const full = await et.getExpense(t.db, ctx, wrapped.id);
    expect(full.imported).toBe(true);
    expect(full.editable).toBe(true);
    expect(full.payee_name).toBe('IRS');
    expect(full.total_amount).toBe('690.2000');

    const updated = await t.db.transaction().execute(trx => et.updateExpense(trx, ctx, wrapped.id, {
      transaction_date: '2026-03-08', payee_text: 'IRS',
      payment_account_id: cash.id, payment_method: 'other',
      lines: [{ category_account_id: supplies.id, amount: '700.00' }],
    }));
    expect(updated.total_amount).toBe('700.0000');

    await t.db.transaction().execute(trx => et.deleteExpense(trx, ctx, wrapped.id));
    const row = await t.db.selectFrom('expense_transactions').select('id')
      .where('id', '=', wrapped.id).executeTakeFirst();
    expect(row).toBeUndefined();
  });
});
