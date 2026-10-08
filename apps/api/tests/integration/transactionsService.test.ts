import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import {
  makeFirm, makeBusiness, makeUser, grantAccess, makeAccount, makeBankAccount, makeVendor, makeCustomer,
  seedCoa, seedYearPeriods,
} from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as checkSvc from '../../src/services/ap/checkService.js';
import * as expenseSvc from '../../src/services/ap/expenseTransactionService.js';
import * as depositSvc from '../../src/services/banking/bankDepositService.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import { listTransactions } from '../../src/services/core/transactionsService.js';

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
  const cash = await makeAccount(t.db, biz.id, { name: 'Cash in Bank', account_type: 'asset' });
  const expenseAcct = await makeAccount(t.db, biz.id, { name: 'Office Supplies', account_type: 'expense' });
  const ap = await makeAccount(t.db, biz.id, { name: 'Accounts Payable', account_type: 'liability' });
  const ar = await makeAccount(t.db, biz.id, { name: 'Accounts Receivable', account_type: 'asset' });
  const revenue = await makeAccount(t.db, biz.id, { name: 'Service Revenue', account_type: 'revenue' });
  const bankAccount = await makeBankAccount(t.db, biz.id, cash.id, { name: 'Operating Checking' });
  const vendor = await makeVendor(t.db, biz.id, { name: 'Acme Supplies' });
  const customer = await makeCustomer(t.db, biz.id, { name: 'Sterling Advisors' });
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { firm, biz, user, ctx, cash, expenseAcct, ap, ar, revenue, bankAccount, vendor, customer };
}

describe('transactionsService.listTransactions', () => {
  it('merges deposits, expenses (incl. legacy check-by-expense), real checks, standalone journals, bills, payments and credit memos into one row shape', async () => {
    const { ctx, biz, expenseAcct, ap, ar, revenue, bankAccount, vendor, customer } = await bootstrap();

    const deposit = await t.db.transaction().execute(trx => depositSvc.createDeposit(trx, ctx, {
      deposit_date: '2026-04-01',
      bank_account_id: bankAccount.id,
      lines: [{ line_type: 'other_funds', account_id: revenue.id, received_from: 'Walk-in', amount: '500.00' }],
    }));

    const expense = await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, ctx, {
      transaction_date: '2026-04-02',
      vendor_id: vendor.id,
      payment_account_id: bankAccount.cash_account_id,
      payment_method: 'ach',
      lines: [{ category_account_id: expenseAcct.id, amount: '80.00' }],
    }));

    const legacyCheck = await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, ctx, {
      transaction_date: '2026-04-03',
      vendor_id: vendor.id,
      payment_account_id: bankAccount.cash_account_id,
      payment_method: 'check',
      reference: '5001',
      lines: [{ category_account_id: expenseAcct.id, amount: '90.00' }],
    }));

    const check = await t.db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, {
      payment_date: '2026-04-04',
      payee_id: vendor.id,
      payee_type: 'vendor',
      bank_account_id: bankAccount.id,
      lines: [{ account_id: expenseAcct.id, amount: '60.00' }],
    }));

    const journal = await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id,
      entry_date: '2026-04-05',
      source_type: 'manual',
      lines: [
        { account_id: expenseAcct.id, debit: '25.00', credit: '0' },
        { account_id: ap.id, debit: '0', credit: '25.00' },
      ],
    }));

    // draft, not posted: posted rows require posted_at + a real posted_journal_entry_id
    // (DB check constraints), which isn't this test's concern — only that the
    // UNION branch's column references are correct and the row shows up.
    const bill = await t.db.insertInto('bills').values({
      business_id: biz.id, vendor_id: vendor.id, bill_number: 'B-1001',
      bill_date: '2026-04-06', due_date: '2026-05-06', status: 'draft',
      subtotal: '200.00', total: '200.00', ap_account_id: ap.id,
    }).returning('id').executeTakeFirstOrThrow();

    const payment = await t.db.insertInto('payments').values({
      business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-07',
      payment_method: 'check', amount: '300.00', unapplied_amount: '300.00',
      cash_account_id: bankAccount.cash_account_id, status: 'draft',
    }).returning('id').executeTakeFirstOrThrow();

    const creditMemo = await t.db.insertInto('credit_memos').values({
      business_id: biz.id, customer_id: customer.id, memo_date: '2026-04-08',
      amount: '40.00', remaining_amount: '40.00', ar_account_id: ar.id, revenue_account_id: revenue.id,
      status: 'draft',
    }).returning('id').executeTakeFirstOrThrow();

    const { rows, total } = await listTransactions(t.db, {
      business_id: biz.id, limit: 50, offset: 0, sort_key: 'date', sort_dir: 'asc',
    });

    expect(total).toBe(8);
    const byId = new Map(rows.map(r => [r.id, r]));

    expect(byId.get(deposit.id)).toMatchObject({ type: 'deposit', path: `/accounting/bank-deposits/${deposit.id}`, due_date: null, balance: '0.00' });
    expect(byId.get(expense.id)).toMatchObject({ type: 'expense', contact_name: 'Acme Supplies', path: `/accounting/expenses/${expense.id}`, due_date: null, balance: '0.00' });
    expect(byId.get(legacyCheck.id)).toMatchObject({ type: 'check', ref_no: '5001', path: `/accounting/expenses/${legacyCheck.id}` });
    expect(byId.get(check.id)).toMatchObject({ type: 'check', contact_name: 'Acme Supplies', path: `/accounting/checks/${check.id}`, balance: '0.00' });
    expect(byId.get(journal.id)).toMatchObject({ type: 'journal', path: `/journal/${journal.id}` });
    // Bill: unpaid (not 'paid'), so its full total is still outstanding.
    expect(byId.get(bill.id)).toMatchObject({ type: 'bill', ref_no: 'B-1001', contact_name: 'Acme Supplies', path: `/ap/bills/${bill.id}`, due_date: '2026-05-06', balance: '200.0000' });
    expect(byId.get(payment.id)).toMatchObject({ type: 'payment', contact_name: 'Sterling Advisors', path: `/payments/${payment.id}`, due_date: null, balance: '300.0000' });
    expect(byId.get(creditMemo.id)).toMatchObject({ type: 'credit_memo', contact_name: 'Sterling Advisors', path: `/credit-memos/${creditMemo.id}`, due_date: null, balance: '40.0000' });

    // Rows generated by other sources (expense/check JEs, etc.) must not
    // leak in as spurious extra 'journal' rows alongside the standalone one.
    expect(rows.filter(r => r.type === 'journal')).toHaveLength(1);
  });

  it('lists invoices, bill payments and vendor credits, with what is still open on each', async () => {
    const { biz, ap, ar, expenseAcct, bankAccount, vendor, customer } = await bootstrap();
    const invoice = await t.db.insertInto('invoices').values({
      business_id: biz.id, customer_id: customer.id, invoice_number: 'INV-2001', issue_date: '2026-04-10', due_date: '2026-05-10',
      status: 'draft', subtotal: '500.00', total: '500.00', ar_account_id: ar.id,
    }).returning('id').executeTakeFirstOrThrow();
    const billPayment = await t.db.insertInto('bill_payments').values({
      business_id: biz.id, vendor_id: vendor.id, payment_date: '2026-04-11', payment_method: 'check', reference: '7001',
      amount: '120.00', unapplied_amount: '20.00', cash_account_id: bankAccount.cash_account_id, status: 'draft',
    }).returning('id').executeTakeFirstOrThrow();
    const vendorCredit = await t.db.insertInto('vendor_credits').values({
      business_id: biz.id, vendor_id: vendor.id, vendor_credit_number: 'VC-1', credit_date: '2026-04-12',
      amount: '75.00', remaining_amount: '75.00', offset_account_id: expenseAcct.id, ap_account_id: ap.id, status: 'draft',
    }).returning('id').executeTakeFirstOrThrow();

    const { rows, total } = await listTransactions(t.db, { business_id: biz.id, limit: 50, offset: 0 });
    expect(total).toBe(3);
    const byId = new Map(rows.map(r => [r.id, r]));
    expect(byId.get(invoice.id)).toMatchObject({ type: 'invoice', ref_no: 'INV-2001', contact_name: 'Sterling Advisors', path: `/invoices/${invoice.id}`, due_date: '2026-05-10' });
    // A draft is not owed yet, so nothing is open on it; its amount still shows.
    expect(Number(byId.get(invoice.id)?.balance)).toBe(0);
    expect(Number(byId.get(invoice.id)?.total_amount)).toBe(500);
    expect(byId.get(billPayment.id)).toMatchObject({ type: 'bill_payment', ref_no: '7001', contact_name: 'Acme Supplies', path: `/ap/bill-payments/${billPayment.id}` });
    expect(Number(byId.get(billPayment.id)?.balance)).toBe(20);
    expect(byId.get(vendorCredit.id)).toMatchObject({ type: 'vendor_credit', ref_no: 'VC-1', path: `/ap/vendor-credits/${vendorCredit.id}` });

    const onlyInvoices = await listTransactions(t.db, { business_id: biz.id, type: 'invoice', limit: 50, offset: 0 });
    expect(onlyInvoices.total).toBe(1);
  });

  it('filters by type, date range and amount', async () => {
    const { ctx, biz, expenseAcct, bankAccount, vendor } = await bootstrap();
    await t.db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, {
      payment_date: '2026-04-04',
      payee_id: vendor.id,
      payee_type: 'vendor',
      bank_account_id: bankAccount.id,
      lines: [{ account_id: expenseAcct.id, amount: '60.00' }],
    }));
    await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, ctx, {
      transaction_date: '2026-04-02',
      vendor_id: vendor.id,
      payment_account_id: bankAccount.cash_account_id,
      payment_method: 'ach',
      lines: [{ category_account_id: expenseAcct.id, amount: '80.00' }],
    }));

    const byType = await listTransactions(t.db, { business_id: biz.id, type: 'check', limit: 50, offset: 0 });
    expect(byType.total).toBe(1);
    expect(byType.rows[0]?.type).toBe('check');

    const byDate = await listTransactions(t.db, { business_id: biz.id, date_start: '2026-04-03', date_end: '2026-04-05', limit: 50, offset: 0 });
    expect(byDate.total).toBe(1);

    const byAmount = await listTransactions(t.db, { business_id: biz.id, amount_op: 'gt', amount_value: '70', limit: 50, offset: 0 });
    expect(byAmount.total).toBe(1);
    expect(byAmount.rows[0]?.total_amount).toBe('80.0000');

    const byAmountGte = await listTransactions(t.db, { business_id: biz.id, amount_op: 'gte', amount_value: '80', limit: 50, offset: 0 });
    expect(byAmountGte.total).toBe(1);

    const byAmountLte = await listTransactions(t.db, { business_id: biz.id, amount_op: 'lte', amount_value: '60', limit: 50, offset: 0 });
    expect(byAmountLte.total).toBe(1);
    expect(byAmountLte.rows[0]?.total_amount).toBe('60.0000');
  });
});
