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

    const status = await recon.getStatus(t.db, d.ctx, d.checking.id);
    expect(status).toEqual({ beginning_balance: '0.00', in_progress_id: null });

    const started = await t.db.transaction().execute(trx => recon.startReconciliation(trx, d.ctx, {
      account_id: d.checking.id, statement_ending_balance: '400.00', statement_ending_date: '2026-03-31',
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
    const nextStatus = await recon.getStatus(t.db, d.ctx, d.checking.id);
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
      account_id: d.checking.id, statement_ending_balance: '0.00', statement_ending_date: '2026-03-31',
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
      account_id: d.checking.id, statement_ending_balance: '-5.00', statement_ending_date: '2026-03-31',
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
      account_id: d.checking.id, statement_ending_balance: '200.00', statement_ending_date: '2026-03-31',
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

  it('lists every reconcilable account with its QuickBooks-style category, not only registered bank accounts', async () => {
    const d = await setup(t);
    const card = await makeAccount(t.db, d.business.id, { code: '2100', name: 'Visa Business Card', account_type: 'liability', detail_type: 'Credit Card' });
    const fixedAsset = await makeAccount(t.db, d.business.id, { code: '1500', name: 'Office Equipment', account_type: 'asset', detail_type: 'Fixed Asset Other Tools Equipment' });
    const equity = await makeAccount(t.db, d.business.id, { code: '3000', name: "Owner's Equity", account_type: 'equity' });
    const otherCurrentLiability = await makeAccount(t.db, d.business.id, { code: '2150', name: 'Line of Credit', account_type: 'liability', detail_type: 'Other Current Liability' });

    const accounts = await recon.listReconcilableAccounts(t.db, d.ctx);
    const byId = new Map(accounts.map(a => [a.id, a]));
    expect(byId.get(d.checking.id)).toMatchObject({ category: 'Bank' });
    expect(byId.get(card.id)).toMatchObject({ category: 'Credit Card' });
    expect(byId.get(fixedAsset.id)).toMatchObject({ category: 'Fixed Asset' });
    expect(byId.get(equity.id)).toMatchObject({ category: 'Equity' });
    expect(byId.get(otherCurrentLiability.id)).toMatchObject({ category: 'Other Current Liability' });
    // Revenue/expense accounts never show up here.
    expect(byId.has(d.supplies.id)).toBe(false);
  });

  it('reconciles a credit card directly: a charge increases its balance (the opposite sign from a bank payment), and a bank-paid payment to the card clears it', async () => {
    const d = await setup(t);
    const card = await makeAccount(t.db, d.business.id, { code: '2100', name: 'Visa Business Card', account_type: 'liability', detail_type: 'Credit Card' });

    const purchase = await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, d.ctx, {
      transaction_date: '2026-03-08', payee_text: 'Office Depot', payment_account_id: card.id, payment_method: 'credit_card',
      lines: [{ category_account_id: d.supplies.id, amount: '60.00' }],
    }));
    // Paying the card down from the bank account: an expense FROM the bank,
    // categorized TO the card — the card never appears as this expense's own
    // payment_account_id, only as a line inside its journal entry.
    const payment = await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, d.ctx, {
      transaction_date: '2026-03-20', payee_text: 'Visa', payment_account_id: d.checking.id, payment_method: 'check',
      lines: [{ category_account_id: card.id, amount: '20.00' }],
    }));

    const started = await t.db.transaction().execute(trx => recon.startReconciliation(trx, d.ctx, {
      account_id: card.id, statement_ending_balance: '40.00', statement_ending_date: '2026-03-31',
    }));

    const worksheet = await recon.getWorksheet(t.db, d.ctx, started.id);
    expect(worksheet.category).toBe('Credit Card');
    const purchaseItem = worksheet.items.find(i => i.transaction_id === purchase.id);
    // A charge increases what's owed on the card — positive, unlike a bank
    // expense (which is always negative, money leaving an asset account).
    expect(purchaseItem).toMatchObject({ transaction_type: 'expense', amount: '60.0000', is_cleared: false });
    const paymentItem = worksheet.items.find(i => i.transaction_id === payment.journal_entry_id);
    // Paying the card down decreases what's owed — negative — and surfaces
    // through the generic journal-entry line, not the expense query, since
    // this expense's own payment_account_id is the bank, not the card.
    expect(paymentItem).toMatchObject({ transaction_type: 'journal_entry', amount: '-20.0000' });

    await t.db.transaction().execute(trx => recon.saveProgress(trx, d.ctx, started.id, [
      { transaction_type: 'expense', transaction_id: purchase.id, is_cleared: true },
      { transaction_type: 'journal_entry', transaction_id: payment.journal_entry_id!, is_cleared: true },
    ]));
    const completed = await t.db.transaction().execute(trx => recon.finishReconciliation(trx, d.ctx, started.id, {}));
    expect(completed.status).toBe('completed');

    const purchaseRow = await t.db.selectFrom('expense_transactions').selectAll().where('id', '=', purchase.id).executeTakeFirstOrThrow();
    expect(purchaseRow.reconciliation_status).toBe('reconciled');
    const paymentJe = await t.db.selectFrom('journal_entries').selectAll().where('id', '=', payment.journal_entry_id!).executeTakeFirstOrThrow();
    expect(paymentJe.reconciliation_status).toBe('reconciled');
    // The payment's own expense record (on the bank side) is untouched —
    // only the journal entry itself was locked, since that's what the card's
    // worksheet actually reconciled.
    const paymentRow = await t.db.selectFrom('expense_transactions').selectAll().where('id', '=', payment.id).executeTakeFirstOrThrow();
    expect(paymentRow.reconciliation_status).toBe('unreconciled');
  });

  it('history reports the account category and counts a post-reconciliation edit as a change', async () => {
    const d = await setup(t);
    const expense = await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, d.ctx, {
      transaction_date: '2026-03-05', payee_text: 'Staples', payment_account_id: d.checking.id, payment_method: 'check',
      lines: [{ category_account_id: d.supplies.id, amount: '100.00' }],
    }));
    const started = await t.db.transaction().execute(trx => recon.startReconciliation(trx, d.ctx, {
      account_id: d.checking.id, statement_ending_balance: '-100.00', statement_ending_date: '2026-03-31',
    }));
    await t.db.transaction().execute(trx => recon.saveProgress(trx, d.ctx, started.id, [
      { transaction_type: 'expense', transaction_id: expense.id, is_cleared: true },
    ]));
    await t.db.transaction().execute(trx => recon.finishReconciliation(trx, d.ctx, started.id, {}));

    const beforeEdit = await recon.listHistory(t.db, d.ctx, {});
    const row = beforeEdit.find(r => r.id === started.id)!;
    expect(row.category).toBe('Bank');
    expect(row.changes).toBe(0);
    expect(row.auto_adjustment).toBeNull();

    // Editing the now-reconciled expense (allowed for an accountant) should count as a change.
    await t.db.transaction().execute(trx => expenseSvc.updateExpense(trx, d.ctx, expense.id, {
      transaction_date: '2026-03-05', payee_text: 'Staples Inc', payment_account_id: d.checking.id, payment_method: 'check',
      lines: [{ category_account_id: d.supplies.id, amount: '100.00' }],
    }));

    const afterEdit = await recon.listHistory(t.db, d.ctx, {});
    expect(afterEdit.find(r => r.id === started.id)!.changes).toBe(1);
  });
});
