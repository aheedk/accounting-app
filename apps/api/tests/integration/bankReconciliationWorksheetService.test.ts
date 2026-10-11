import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeAccount, makeBankAccount, makeBusiness, makeFirm, makeUser, grantAccess, seedYearPeriods } from '../helpers/factories.js';
import * as recon from '../../src/services/banking/bankReconciliationWorksheetService.js';
import * as expenseSvc from '../../src/services/ap/expenseTransactionService.js';
import * as depositSvc from '../../src/services/banking/bankDepositService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const business = await makeBusiness(t.db, firm.id, 'Reconcile Biz');
  const accountantUser = await makeUser(t.db, firm.id, { role: 'accountant' });
  const firmAdminUser = await makeUser(t.db, firm.id, { role: 'firm_admin' });
  await grantAccess(t.db, accountantUser.id, business.id);
  await grantAccess(t.db, firmAdminUser.id, business.id);
  const ctx: ServiceCtx = {
    user_id: accountantUser.id, firm_id: firm.id, business_id: business.id, effective_role: 'accountant',
    request_id: '00000000-0000-0000-0000-00000000ab20', ip_address: '127.0.0.1', user_agent: 'vitest',
  };
  const adminCtx: ServiceCtx = { ...ctx, user_id: firmAdminUser.id, effective_role: 'firm_admin' };
  await seedYearPeriods(t.db, business.id, 2026);
  const checking = await makeAccount(t.db, business.id, { code: '1010', name: 'Operating Checking', account_type: 'asset', detail_type: 'Checking' });
  const bankAccount = await makeBankAccount(t.db, business.id, checking.id, { name: 'Operating Checking' });
  const supplies = await makeAccount(t.db, business.id, { code: '6010', name: 'Office Supplies', account_type: 'expense' });
  const bankFees = await makeAccount(t.db, business.id, { code: '6020', name: 'Bank Fees', account_type: 'expense' });
  const interestIncome = await makeAccount(t.db, business.id, { code: '4900', name: 'Interest Income', account_type: 'revenue' });
  const salesIncome = await makeAccount(t.db, business.id, { code: '4000', name: 'Sales Income', account_type: 'revenue' });
  return { business, ctx, adminCtx, checking, bankAccount, supplies, bankFees, interestIncome, salesIncome };
}

describe('bank reconciliation worksheet', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('carries 0 forward as the first beginning balance, and clears to zero when every item is checked', async () => {
    const d = await setup(t);

    const expense = await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, d.ctx, {
      transaction_date: '2026-03-05', payee_text: 'Staples', payment_account_id: d.checking.id, payment_method: 'check',
      lines: [{ category_account_id: d.supplies.id, amount: '100.00' }],
    }));
    const deposit = await t.db.transaction().execute(trx => depositSvc.createDeposit(trx, d.ctx, {
      bank_account_id: d.bankAccount.id, deposit_date: '2026-03-10',
      lines: [{ line_type: 'other_funds', received_from: 'A Customer', account_id: d.salesIncome.id, amount: '500.00' }],
    }));

    const status = await recon.getStatus(t.db, d.ctx, d.bankAccount.id);
    expect(status).toEqual({ beginning_balance: '0.00', in_progress_id: null });

    const started = await t.db.transaction().execute(trx => recon.startReconciliation(trx, d.ctx, {
      bank_account_id: d.bankAccount.id, statement_ending_balance: '400.00', statement_ending_date: '2026-03-31',
    }));
    expect(started.status).toBe('in_progress');
    expect(started.beginning_balance).toBe('0.0000');

    const worksheet = await recon.getWorksheet(t.db, d.ctx, started.id);
    const byId = new Map(worksheet.items.map(i => [i.transaction_id, i]));
    expect(byId.get(expense.id)).toMatchObject({ transaction_type: 'expense', amount: '-100.0000', is_cleared: false });
    expect(byId.get(deposit.id)).toMatchObject({ transaction_type: 'deposit', amount: '500.0000', is_cleared: false });
    expect(worksheet.summary.difference).toBe('400.0000');

    await t.db.transaction().execute(trx => recon.saveProgress(trx, d.ctx, started.id, [
      { transaction_type: 'expense', transaction_id: expense.id, is_cleared: true },
      { transaction_type: 'deposit', transaction_id: deposit.id, is_cleared: true },
    ]));
    const afterSave = await recon.getWorksheet(t.db, d.ctx, started.id);
    expect(afterSave.summary.difference).toBe('0.0000');

    const completed = await t.db.transaction().execute(trx => recon.finishReconciliation(trx, d.ctx, started.id, {}));
    expect(completed.status).toBe('completed');
    expect(completed.adjustment_journal_entry_id).toBeNull();

    const expenseRow = await t.db.selectFrom('expense_transactions').selectAll().where('id', '=', expense.id).executeTakeFirstOrThrow();
    expect(expenseRow.reconciliation_status).toBe('reconciled');
    expect(expenseRow.reconciliation_id).toBe(started.id);
    const depositRow = await t.db.selectFrom('bank_deposits').selectAll().where('id', '=', deposit.id).executeTakeFirstOrThrow();
    expect(depositRow.reconciliation_status).toBe('reconciled');

    // The next reconciliation on this account carries this one's ending balance forward.
    const nextStatus = await recon.getStatus(t.db, d.ctx, d.bankAccount.id);
    expect(nextStatus.beginning_balance).toBe('400.0000');

    // A reconciled expense can no longer be deleted, or voided by anyone below a firm admin.
    await expect(t.db.transaction().execute(trx => expenseSvc.deleteExpense(trx, d.ctx, expense.id)))
      .rejects.toThrow(/reconciled/i);
    await expect(t.db.transaction().execute(trx => expenseSvc.voidExpense(trx, d.ctx, { expense_transaction_id: expense.id })))
      .rejects.toThrow(/reconciled/i);
    const voided = await t.db.transaction().execute(trx => expenseSvc.voidExpense(trx, d.adminCtx, { expense_transaction_id: expense.id }));
    expect(voided.status).toBe('void');
  });

  it('refuses to finish out of balance unless the difference is accepted, then books an adjusting entry', async () => {
    const d = await setup(t);
    await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, d.ctx, {
      transaction_date: '2026-03-05', payee_text: 'Staples', payment_account_id: d.checking.id, payment_method: 'check',
      lines: [{ category_account_id: d.supplies.id, amount: '100.00' }],
    }));

    const started = await t.db.transaction().execute(trx => recon.startReconciliation(trx, d.ctx, {
      bank_account_id: d.bankAccount.id, statement_ending_balance: '0.00', statement_ending_date: '2026-03-31',
    }));
    // Nothing checked: cleared balance stays 0, statement says 0 too, so it's already clean —
    // leave the expense unchecked instead, which makes the statement (0) differ from cleared (0) by 0.
    // To force a real difference, claim a higher statement balance than anything clears to.
    await t.db.updateTable('reconciliations').set({ statement_ending_balance: '50.00' }).where('id', '=', started.id).execute();

    await expect(t.db.transaction().execute(trx => recon.finishReconciliation(trx, d.ctx, started.id, {})))
      .rejects.toThrow(/difference/i);

    const completed = await t.db.transaction().execute(trx => recon.finishReconciliation(trx, d.ctx, started.id, { accept_difference: true }));
    expect(completed.status).toBe('completed');
    expect(completed.adjustment_journal_entry_id).not.toBeNull();
    const adjustment = await t.db.selectFrom('journal_entries').selectAll()
      .where('id', '=', completed.adjustment_journal_entry_id!).executeTakeFirstOrThrow();
    expect(adjustment.source_type).toBe('reconciliation_adjustment');
    expect(adjustment.status).toBe('posted');
  });

  it('creates a pre-checked service charge and interest line at Start, and Cancel removes them entirely', async () => {
    const d = await setup(t);
    const started = await t.db.transaction().execute(trx => recon.startReconciliation(trx, d.ctx, {
      bank_account_id: d.bankAccount.id, statement_ending_balance: '-5.00', statement_ending_date: '2026-03-31',
      service_charge_amount: '15.00', service_charge_date: '2026-03-15', service_charge_account_id: d.bankFees.id,
      interest_earned_amount: '10.00', interest_earned_date: '2026-03-20', interest_earned_account_id: d.interestIncome.id,
    }));

    const worksheet = await recon.getWorksheet(t.db, d.ctx, started.id);
    const chargeItem = worksheet.items.find(i => i.transaction_type === 'service_charge');
    const interestItem = worksheet.items.find(i => i.transaction_type === 'interest');
    expect(chargeItem).toMatchObject({ amount: '-15.0000', is_cleared: true });
    expect(interestItem).toMatchObject({ amount: '10.0000', is_cleared: true });
    expect(worksheet.summary.difference).toBe('0.0000');

    const chargeExpenseId = chargeItem!.transaction_id;
    const interestDepositId = interestItem!.transaction_id;

    await t.db.transaction().execute(trx => recon.cancelReconciliation(trx, d.ctx, started.id));

    const cancelled = await t.db.selectFrom('reconciliations').selectAll().where('id', '=', started.id).executeTakeFirstOrThrow();
    expect(cancelled.status).toBe('cancelled');
    const chargeGone = await t.db.selectFrom('expense_transactions').select('id').where('id', '=', chargeExpenseId).executeTakeFirst();
    expect(chargeGone).toBeUndefined();
    const interestGone = await t.db.selectFrom('bank_deposits').select('id').where('id', '=', interestDepositId).executeTakeFirst();
    expect(interestGone).toBeUndefined();
  });

  it('undo (firm admin only) puts a completed reconciliation back in progress and unlocks its items', async () => {
    const d = await setup(t);
    const deposit = await t.db.transaction().execute(trx => depositSvc.createDeposit(trx, d.ctx, {
      bank_account_id: d.bankAccount.id, deposit_date: '2026-03-10',
      lines: [{ line_type: 'other_funds', received_from: 'A Customer', account_id: d.salesIncome.id, amount: '200.00' }],
    }));
    const started = await t.db.transaction().execute(trx => recon.startReconciliation(trx, d.ctx, {
      bank_account_id: d.bankAccount.id, statement_ending_balance: '200.00', statement_ending_date: '2026-03-31',
    }));
    await t.db.transaction().execute(trx => recon.saveProgress(trx, d.ctx, started.id, [
      { transaction_type: 'deposit', transaction_id: deposit.id, is_cleared: true },
    ]));
    await t.db.transaction().execute(trx => recon.finishReconciliation(trx, d.ctx, started.id, {}));

    await expect(t.db.transaction().execute(trx => recon.undoReconciliation(trx, d.ctx, started.id)))
      .rejects.toThrow(/firm admin/i);

    const undone = await t.db.transaction().execute(trx => recon.undoReconciliation(trx, d.adminCtx, started.id));
    expect(undone.status).toBe('in_progress');
    expect(undone.completed_at).toBeNull();

    const depositRow = await t.db.selectFrom('bank_deposits').selectAll().where('id', '=', deposit.id).executeTakeFirstOrThrow();
    expect(depositRow.reconciliation_status).toBe('unreconciled');
    expect(depositRow.reconciliation_id).toBeNull();
  });
});
