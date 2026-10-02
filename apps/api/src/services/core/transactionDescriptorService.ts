import { type Kysely } from 'kysely';
import type { DB, JournalEntrySourceType } from '../../db/types.js';

// What a journal entry *is* to a bookkeeper -- "Invoice 1042 for Acme", not
// "JE 87" -- and where its editable form lives. Shared by the General Ledger
// (type / num / name columns) and the journal entry page (redirect to source).

export type TransactionEntry = {
  id: string;
  source_type: JournalEntrySourceType;
  source_id: string | null;
  transaction_type: string | null;
  payee_name: string | null;
  reference: string | null;
  journal_number: string;
};

export type TransactionDescriptor = {
  /** QBO-style transaction type shown in reports. */
  label: string;
  /** Document number: invoice no., bill no., check no., or the journal no. */
  num: string | null;
  /** Customer, vendor, or payee. */
  name: string | null;
  /**
   * What the transaction was for, from the document itself (its memo, or its
   * line descriptions). Null when the journal entry's own memo is the best there is.
   */
  memo: string | null;
  /** Web path of the transaction's own form; null when the journal entry is the form. */
  path: string | null;
  /** True only for real adjusting journal entries, not system-posted ones. */
  is_adjusting: boolean;
};

function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map(row => [row.id, row]));
}

/** "Widgets" or "Widgets (+2 more)" from a document's line descriptions. */
function summarize(descriptions: string[] | undefined): string | null {
  const filled = (descriptions ?? []).map(d => d.trim()).filter(d => d !== '');
  const first = filled[0];
  if (first === undefined) return null;
  return filled.length === 1 ? first : `${first} (+${filled.length - 1} more)`;
}

function groupBy<T>(rows: T[], key: (row: T) => string | null, value: (row: T) => string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    const list = out.get(k) ?? [];
    list.push(value(row));
    out.set(k, list);
  }
  return out;
}

function idsOf(entries: TransactionEntry[], sourceType: JournalEntrySourceType): string[] {
  return [...new Set(entries
    .filter(entry => entry.source_type === sourceType && entry.source_id !== null)
    .map(entry => entry.source_id as string))];
}

export async function describeTransactions(
  db: Kysely<DB>, entries: TransactionEntry[],
): Promise<Map<string, TransactionDescriptor>> {
  const out = new Map<string, TransactionDescriptor>();
  if (entries.length === 0) return out;

  const invoiceIds = idsOf(entries, 'invoice');
  const paymentIds = idsOf(entries, 'payment');
  const creditMemoIds = idsOf(entries, 'credit_memo');
  const billIds = idsOf(entries, 'bill');
  const billPaymentIds = idsOf(entries, 'bill_payment');
  const vendorCreditIds = idsOf(entries, 'vendor_credit');
  const expenseIds = idsOf(entries, 'expense');
  const bankImportIds = entries.filter(entry => entry.source_type === 'bank_import').map(entry => entry.id);
  // Older services post as unlinked manual/adjustment rows and point back from
  // their own table, so those are found by journal entry id instead.
  const looseIds = entries
    .filter(entry => entry.source_type === 'manual' || entry.source_type === 'adjustment')
    .map(entry => entry.id);

  const [
    invoices, payments, creditMemos, bills, billPayments, vendorCredits, dedicatedExpenses,
    bankImportLines, wrappedImportExpenses, wrappedImportDeposits,
    expenses, depreciation, payRuns, taxPayments, bankMatches, inboxMatches,
    invoiceLines, billLines, paymentApplications, billPaymentApplications, payRunEmployees,
  ] = await Promise.all([
    invoiceIds.length === 0 ? [] : db.selectFrom('invoices as d')
      .innerJoin('customers as c', 'c.id', 'd.customer_id')
      .select(['d.id', 'd.invoice_number as num', 'd.memo', 'c.name'])
      .where('d.id', 'in', invoiceIds).execute(),
    paymentIds.length === 0 ? [] : db.selectFrom('payments as d')
      .innerJoin('customers as c', 'c.id', 'd.customer_id')
      .select(['d.id', 'd.reference as num', 'd.memo', 'c.name'])
      .where('d.id', 'in', paymentIds).execute(),
    creditMemoIds.length === 0 ? [] : db.selectFrom('credit_memos as d')
      .innerJoin('customers as c', 'c.id', 'd.customer_id')
      .select(['d.id', 'd.credit_memo_number as num', 'd.memo', 'c.name'])
      .where('d.id', 'in', creditMemoIds).execute(),
    billIds.length === 0 ? [] : db.selectFrom('bills as d')
      .innerJoin('vendors as v', 'v.id', 'd.vendor_id')
      .select(['d.id', 'd.bill_number as num', 'd.memo', 'v.name'])
      .where('d.id', 'in', billIds).execute(),
    billPaymentIds.length === 0 ? [] : db.selectFrom('bill_payments as d')
      .innerJoin('vendors as v', 'v.id', 'd.vendor_id')
      .select(['d.id', 'd.reference as num', 'd.payment_method', 'd.memo', 'v.name'])
      .where('d.id', 'in', billPaymentIds).execute(),
    vendorCreditIds.length === 0 ? [] : db.selectFrom('vendor_credits as d')
      .innerJoin('vendors as v', 'v.id', 'd.vendor_id')
      .select(['d.id', 'd.vendor_credit_number as num', 'd.memo', 'v.name'])
      .where('d.id', 'in', vendorCreditIds).execute(),
    expenseIds.length === 0 ? [] : db.selectFrom('expense_transactions as e')
      .leftJoin('vendors as v', 'v.id', 'e.vendor_id')
      .leftJoin('customers as c', 'c.id', 'e.customer_id')
      .select(['e.id', 'e.reference', 'e.payment_method', 'e.memo', 'e.payee_text', 'v.name as vendor_name', 'c.name as customer_name'])
      .where('e.id', 'in', expenseIds).execute(),
    bankImportIds.length === 0 ? [] : db.selectFrom('journal_entry_lines')
      .select(({ fn }) => ['journal_entry_id', fn.countAll<string>().as('line_count')])
      .where('journal_entry_id', 'in', bankImportIds)
      .groupBy('journal_entry_id').execute(),
    // An AI-imported check/expense (or deposit) may have been wrapped into its
    // own feature's table after the fact (wrapImportedExpenseJournalEntry /
    // wrapImportedDepositJournalEntry) — its JE keeps source_type='bank_import'
    // forever (protect_posted treats source_type as permanent identity), so
    // that wrapper can only be found by this back-link, never by source_type.
    bankImportIds.length === 0 ? [] : db.selectFrom('expense_transactions as e')
      .leftJoin('vendors as v', 'v.id', 'e.vendor_id')
      .leftJoin('customers as c', 'c.id', 'e.customer_id')
      .select(['e.id', 'e.journal_entry_id', 'e.payment_method', 'e.reference', 'e.payee_text', 'e.memo', 'v.name as vendor_name', 'c.name as customer_name'])
      .where('e.journal_entry_id', 'in', bankImportIds).execute(),
    bankImportIds.length === 0 ? [] : db.selectFrom('bank_deposits')
      .select(['id', 'journal_entry_id'])
      .where('journal_entry_id', 'in', bankImportIds).execute(),
    looseIds.length === 0 ? [] : db.selectFrom('expense_transactions as e')
      .leftJoin('vendors as v', 'v.id', 'e.vendor_id')
      .select(['e.id', 'e.journal_entry_id', 'e.payment_method', 'e.reference', 'e.payee_text', 'e.memo', 'v.name as vendor_name'])
      .where('e.journal_entry_id', 'in', looseIds).execute(),
    looseIds.length === 0 ? [] : db.selectFrom('depreciation_entries')
      .select(['journal_entry_id', 'fixed_asset_id'])
      .where('journal_entry_id', 'in', looseIds).execute(),
    looseIds.length === 0 ? [] : db.selectFrom('pay_runs')
      .select(['journal_entry_id', 'memo', 'pay_period_start', 'pay_period_end'])
      .where('journal_entry_id', 'in', looseIds).execute(),
    looseIds.length === 0 ? [] : db.selectFrom('payroll_tax_liabilities')
      .select(['payment_journal_entry_id as journal_entry_id'])
      .where('payment_journal_entry_id', 'in', looseIds).execute(),
    looseIds.length === 0 ? [] : db.selectFrom('bank_transactions')
      .select(['matched_journal_entry_id as journal_entry_id', 'status', 'amount'])
      .where('matched_journal_entry_id', 'in', looseIds).execute(),
    looseIds.length === 0 ? [] : db.selectFrom('integration_inbox')
      .select(['matched_journal_entry_id as journal_entry_id'])
      .where('matched_journal_entry_id', 'in', looseIds).execute(),
    invoiceIds.length === 0 ? [] : db.selectFrom('invoice_lines')
      .select(['invoice_id', 'description'])
      .where('invoice_id', 'in', invoiceIds).orderBy('line_number').execute(),
    billIds.length === 0 ? [] : db.selectFrom('bill_lines')
      .select(['bill_id', 'description'])
      .where('bill_id', 'in', billIds).orderBy('line_number').execute(),
    paymentIds.length === 0 ? [] : db.selectFrom('payment_applications as pa')
      .innerJoin('invoices as i', 'i.id', 'pa.invoice_id')
      .select(['pa.payment_id', 'i.invoice_number'])
      .where('pa.payment_id', 'in', paymentIds).orderBy('i.invoice_number').execute(),
    billPaymentIds.length === 0 ? [] : db.selectFrom('bill_payment_applications as pa')
      .innerJoin('bills as b', 'b.id', 'pa.bill_id')
      .select(['pa.bill_payment_id', 'b.bill_number'])
      .where('pa.bill_payment_id', 'in', billPaymentIds).orderBy('b.bill_number').execute(),
    looseIds.length === 0 ? [] : db.selectFrom('pay_runs as r')
      .innerJoin('pay_run_lines as l', 'l.pay_run_id', 'r.id')
      .innerJoin('employees as e', 'e.id', 'l.employee_id')
      .select(['r.journal_entry_id', 'e.full_name'])
      .where('r.journal_entry_id', 'in', looseIds).orderBy('e.full_name').execute(),
  ]);

  const invoiceById = byId(invoices);
  const paymentById = byId(payments);
  const creditMemoById = byId(creditMemos);
  const billById = byId(bills);
  const billPaymentById = byId(billPayments);
  const vendorCreditById = byId(vendorCredits);
  const expenseById = byId(dedicatedExpenses);
  const importLineCount = new Map(bankImportLines.map(row => [row.journal_entry_id, Number(row.line_count)]));
  const wrappedExpenseByJe = new Map(wrappedImportExpenses.map(row => [row.journal_entry_id, row]));
  const wrappedDepositByJe = new Map(wrappedImportDeposits.map(row => [row.journal_entry_id, row]));
  const expenseByEntry = new Map(expenses.map(row => [row.journal_entry_id, row]));
  const depreciationByEntry = new Map(depreciation.map(row => [row.journal_entry_id, row]));
  const payRunByEntry = new Map(payRuns.map(row => [row.journal_entry_id, row]));
  const invoiceLinesById = groupBy(invoiceLines, row => row.invoice_id, row => row.description);
  const billLinesById = groupBy(billLines, row => row.bill_id, row => row.description);
  const invoicesByPayment = groupBy(paymentApplications, row => row.payment_id, row => row.invoice_number);
  const billsByPayment = groupBy(billPaymentApplications, row => row.bill_payment_id, row => row.bill_number);
  const employeesByEntry = groupBy(payRunEmployees, row => row.journal_entry_id, row => row.full_name);
  const taxPaymentEntries = new Set(taxPayments.map(row => row.journal_entry_id));
  const bankMatchByEntry = new Map(bankMatches.map(row => [row.journal_entry_id, row]));
  const inboxEntries = new Set(inboxMatches.map(row => row.journal_entry_id));

  for (const entry of entries) {
    const sid = entry.source_id;
    const journal: TransactionDescriptor = {
      label: 'Journal Entry',
      num: entry.reference ?? entry.journal_number,
      name: entry.payee_name,
      memo: null,
      path: null,
      is_adjusting: false,
    };
    let described = journal;

    switch (entry.source_type) {
      case 'invoice': {
        const doc = sid ? invoiceById.get(sid) : undefined;
        described = {
          label: 'Invoice', num: doc?.num ?? null, name: doc?.name ?? null,
          memo: doc?.memo?.trim() || summarize(sid ? invoiceLinesById.get(sid) : undefined),
          path: sid ? `/invoices/${sid}` : null, is_adjusting: false,
        };
        break;
      }
      case 'payment': {
        const doc = sid ? paymentById.get(sid) : undefined;
        const paid = sid ? invoicesByPayment.get(sid) : undefined;
        described = {
          label: 'Payment', num: doc?.num ?? null, name: doc?.name ?? null,
          memo: doc?.memo?.trim() || (paid?.length ? `Payment for ${paid.join(', ')}` : null),
          path: sid ? `/payments/${sid}` : null, is_adjusting: false,
        };
        break;
      }
      case 'credit_memo': {
        const doc = sid ? creditMemoById.get(sid) : undefined;
        described = { label: 'Credit Memo', num: doc?.num ?? null, name: doc?.name ?? null, memo: doc?.memo?.trim() || null, path: sid ? `/credit-memos/${sid}` : null, is_adjusting: false };
        break;
      }
      case 'bill': {
        const doc = sid ? billById.get(sid) : undefined;
        described = {
          label: 'Bill', num: doc?.num ?? null, name: doc?.name ?? null,
          memo: doc?.memo?.trim() || summarize(sid ? billLinesById.get(sid) : undefined),
          path: sid ? `/ap/bills/${sid}` : null, is_adjusting: false,
        };
        break;
      }
      case 'bill_payment': {
        const doc = sid ? billPaymentById.get(sid) : undefined;
        const paidBills = sid ? billsByPayment.get(sid) : undefined;
        described = {
          label: doc?.payment_method === 'check' ? 'Bill Payment (Check)' : 'Bill Payment',
          num: doc?.num ?? null, name: doc?.name ?? null,
          memo: doc?.memo?.trim() || (paidBills?.length ? `Payment for bill ${paidBills.join(', ')}` : null),
          path: sid ? `/ap/bill-payments/${sid}` : null, is_adjusting: false,
        };
        break;
      }
      case 'vendor_credit': {
        const doc = sid ? vendorCreditById.get(sid) : undefined;
        described = { label: 'Vendor Credit', num: doc?.num ?? null, name: doc?.name ?? null, memo: doc?.memo?.trim() || null, path: sid ? `/ap/vendor-credits/${sid}` : null, is_adjusting: false };
        break;
      }
      case 'expense': {
        const doc = sid ? expenseById.get(sid) : undefined;
        described = {
          label: doc?.payment_method === 'check' ? 'Check' : 'Expense',
          num: doc?.reference ?? null,
          name: doc?.vendor_name ?? doc?.customer_name ?? doc?.payee_text ?? null,
          memo: doc?.memo?.trim() || null,
          path: sid ? `/accounting/expenses/${sid}` : null,
          is_adjusting: false,
        };
        break;
      }
      case 'bank_import': {
        const wrappedExpense = wrappedExpenseByJe.get(entry.id);
        const wrappedDeposit = wrappedDepositByJe.get(entry.id);
        if (wrappedExpense) {
          described = {
            label: wrappedExpense.payment_method === 'check' ? 'Check' : 'Expense',
            num: wrappedExpense.reference, name: wrappedExpense.vendor_name ?? wrappedExpense.customer_name ?? wrappedExpense.payee_text,
            memo: wrappedExpense.memo?.trim() || null,
            path: `/accounting/expenses/${wrappedExpense.id}`,
            is_adjusting: false,
          };
        } else if (wrappedDeposit) {
          described = {
            label: 'Deposit', num: entry.reference, name: entry.payee_name, memo: null,
            path: `/accounting/bank-deposits/${wrappedDeposit.id}`,
            is_adjusting: false,
          };
        } else {
          const label = entry.transaction_type === 'deposit' ? 'Deposit'
            : entry.transaction_type === 'check' ? 'Check'
            : entry.transaction_type === 'expense' ? 'Expense'
            : 'Bank Import';
          described = {
            label, num: entry.reference, name: entry.payee_name, memo: null,
            // Not (yet) wrapped into its own feature's table: an imported Check /
            // Expense / Deposit with exactly 2 lines still lands on the raw
            // import-review form; a split one has no form at all, only the inbox.
            path: importLineCount.get(entry.id) === 2 ? `/transactions/${entry.id}` : '/ai/inbox',
            is_adjusting: false,
          };
        }
        break;
      }
      case 'invoice_import':
        // PDF invoice imports are posted from the AI inbox.
        described = { label: 'Invoice', num: entry.reference, name: entry.payee_name, memo: null, path: '/ai/inbox', is_adjusting: false };
        break;
      case 'reversal':
        break;
      case 'manual':
      case 'adjustment': {
        const expense = expenseByEntry.get(entry.id);
        const dep = depreciationByEntry.get(entry.id);
        const bankMatch = bankMatchByEntry.get(entry.id);
        const payRun = payRunByEntry.get(entry.id);
        if (expense) {
          described = {
            label: expense.payment_method === 'check' ? 'Check' : 'Expense',
            num: expense.reference,
            name: expense.vendor_name ?? expense.payee_text,
            memo: expense.memo?.trim() || null,
            path: `/accounting/expenses/${expense.id}`,
            is_adjusting: false,
          };
        } else if (dep) {
          // Depreciation is a true period-end adjustment.
          described = { ...journal, path: `/accounting/fixed-assets/${dep.fixed_asset_id}`, is_adjusting: true };
        } else if (payRun) {
          // One entry covers the whole run, so name the employee only when there is just one.
          const employees = employeesByEntry.get(entry.id) ?? [];
          described = {
            ...journal, label: 'Payroll', path: '/payroll/overview',
            name: employees.length === 1 ? employees[0]! : employees.length > 1 ? `${employees.length} employees` : null,
            memo: payRun.memo?.trim() || `Payroll ${payRun.pay_period_start} to ${payRun.pay_period_end}`,
          };
        } else if (taxPaymentEntries.has(entry.id)) {
          described = { ...journal, label: 'Tax Payment', path: '/payroll/taxes' };
        } else if (bankMatch) {
          // Categorising a bank line creates the entry; matching only links an existing one.
          const label = bankMatch.status === 'categorized'
            ? (Number(bankMatch.amount) > 0 ? 'Deposit' : 'Expense')
            : 'Journal Entry';
          described = { ...journal, label, num: entry.reference, path: '/accounting/bank-transactions' };
        } else if (inboxEntries.has(entry.id)) {
          described = { ...journal, path: '/accounting/bank-transactions' };
        } else {
          described = { ...journal, is_adjusting: entry.source_type === 'adjustment' };
        }
        break;
      }
    }
    out.set(entry.id, described);
  }
  return out;
}
