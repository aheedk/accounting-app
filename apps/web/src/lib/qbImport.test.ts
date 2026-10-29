import { describe, expect, it } from 'vitest';
import {
  parseAccounts, parseAmount, parseContacts, parseDate, parseItems, parseJournal, parseOpenItems, parseTrialBalance, parseUncleared, termsDays,
} from './qbImport';

// Grids shaped like QuickBooks' exports: title rows over the headings, rows
// grouped under a customer or vendor, and "Total for" rows.
const title = (name: string) => [[name], ['Acme Books LLC'], ['As of October 31, 2026'], []];

describe('QuickBooks export readers', () => {
  it('reads amounts and dates as QuickBooks writes them', () => {
    expect(parseAmount('1,234.56')).toBe('1234.56');
    expect(parseAmount('(1,234.56)')).toBe('-1234.56');
    expect(parseAmount('-$50.00')).toBe('-50.00');
    expect(parseAmount('')).toBe('');
    expect(parseAmount('abc')).toBeNull();
    expect(parseDate('10/31/2026')).toBe('2026-10-31');
    expect(parseDate('1/5/26')).toBe('2026-01-05');
    expect(parseDate('2026-02-30')).toBeNull();
    expect(termsDays('Net 30')).toBe(30);
    expect(termsDays('Due on receipt')).toBe(0);
  });

  it('reads the account list, with QuickBooks type names and sub-accounts', () => {
    const grid = [
      ...title('Account List'),
      ['Account #', 'Account', 'Type', 'Detail Type', 'Description', 'Balance'],
      ['1000', 'Business Checking', 'Bank', 'Checking', '', '10,000.00'],
      ['', 'Utilities:Gas', 'Expenses', 'Utilities', 'Gas bill', ''],
      ['', 'Mystery', 'Spaceship', '', '', ''],
    ];
    const { rows, problems } = parseAccounts(grid);
    expect(rows).toEqual([
      { name: 'Business Checking', number: '1000', account_type: 'asset', detail_type: 'Checking', description: null },
      { name: 'Utilities:Gas', number: null, account_type: 'expense', detail_type: 'Utilities', description: 'Gas bill' },
    ]);
    expect(problems).toEqual(['Mystery: QuickBooks type "Spaceship" isn\'t one this page knows']);
  });

  it('reads customers with their address and terms', () => {
    const grid = [
      ...title('Customer Contact List'),
      ['Customer', 'Company name', 'Email', 'Phone', 'Billing street', 'Billing city', 'Billing state', 'Billing ZIP', 'Terms'],
      ['Acme Corp', 'Acme', 'ap@acme.test, boss@acme.test', '555-0100', '1 Main St', 'Austin', 'TX', '78701', 'Net 30'],
    ];
    expect(parseContacts(grid, 'Customers').rows).toEqual([{
      name: 'Acme Corp', company_name: 'Acme', email: 'ap@acme.test', phone: '555-0100',
      billing_address: { line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78701' },
      terms_days: 30, notes: null,
    }]);
  });

  it('reads products and services, leaving out bundles', () => {
    const grid = [
      ['Product/Service Name', 'SKU', 'Type', 'Sales Description', 'Sales Price / Rate', 'Income Account', 'Purchase Cost', 'Expense Account', 'Quantity On Hand', 'Inventory Asset Account'],
      ['Widget', 'W-1', 'Inventory', 'A widget', '12.50', 'Sales of Product Income', '5.00', 'Cost of Goods Sold', '10', 'Inventory Asset'],
      ['Kit', '', 'Bundle', '', '', '', '', '', '', ''],
    ];
    expect(parseItems(grid).rows).toEqual([{
      name: 'Widget', sku: 'W-1', description: 'A widget', sale_price: '12.50', purchase_cost: '5.00',
      income_account: 'Sales of Product Income', expense_account: 'Cost of Goods Sold', inventory_asset_account: 'Inventory Asset', quantity_on_hand: '10',
    }]);
  });

  it('reads open invoices grouped under each customer', () => {
    const grid = [
      ...title('Open Invoices'),
      ['', 'Date', 'Transaction Type', 'Num', 'Terms', 'Due Date', 'Open Balance'],
      ['Acme Corp'],
      ['', '10/05/2026', 'Invoice', '1047', 'Net 30', '11/04/2026', '500.00'],
      ['', '10/10/2026', 'Credit Memo', 'CM9', '', '', '-50.00'],
      ['Total for Acme Corp', '', '', '', '', '', '450.00'],
      ['Beta LLC'],
      ['', '09/20/2026', 'Invoice', '1040', '', '09/20/2026', '250.00'],
      ['TOTAL', '', '', '', '', '', '700.00'],
    ];
    const { rows, problems } = parseOpenItems(grid, 'Open Invoices');
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { name: 'Acme Corp', type: 'Invoice', date: '2026-10-05', number: '1047', due_date: '2026-11-04', terms: 'Net 30', amount: '500.00' },
      { name: 'Acme Corp', type: 'Credit Memo', date: '2026-10-10', number: 'CM9', due_date: null, terms: null, amount: '-50.00' },
      { name: 'Beta LLC', type: 'Invoice', date: '2026-09-20', number: '1040', due_date: '2026-09-20', terms: null, amount: '250.00' },
    ]);
  });

  it('takes only the uncleared sections of a reconciliation report, money in as positive', () => {
    const grid = [
      ...title('Business Checking, Period Ending 10/31/2026'),
      ['Date', 'Type', 'Num', 'Name', 'Amount'],
      ['Cleared transactions'],
      ['Checks and payments'],
      ['10/02/2026', 'Check', '1199', 'Landlord', '-1,000.00'],
      ['Uncleared transactions as of 10/31/2026'],
      ['Checks and payments'],
      ['10/29/2026', 'Check', '1201', 'Power Co', '300.00'],
      ['Total Checks and payments', '', '', '', '300.00'],
      ['Deposits and other credits'],
      ['10/30/2026', 'Deposit', '', '', '150.00'],
    ];
    expect(parseUncleared(grid).rows).toEqual([
      { date: '2026-10-29', type: 'Check', number: '1201', name: 'Power Co', memo: null, amount: '-300.00' },
      { date: '2026-10-30', type: 'Deposit', number: null, name: null, memo: null, amount: '150.00' },
    ]);
  });

  it('reads the trial balance, a negative debit as a credit', () => {
    const grid = [
      ...title('Trial Balance'),
      ['', 'Debit', 'Credit'],
      ['1000 Business Checking', '10,000.00', ''],
      ['Visa', '', '400.00'],
      ['Undeposited Funds', '-25.00', ''],
      ['Opening Balance Equity', '', ''],
      ['TOTAL', '10,000.00', '10,000.00'],
    ];
    expect(parseTrialBalance(grid).rows).toEqual([
      { account: '1000 Business Checking', debit: '10000.00', credit: '0' },
      { account: 'Visa', debit: '0', credit: '400.00' },
      { account: 'Undeposited Funds', debit: '0', credit: '25.00' },
    ]);
  });

  it('reads the journal report into transactions', () => {
    const grid = [
      ...title('Journal'),
      ['', 'Date', 'Transaction Type', 'Num', 'Name', 'Memo/Description', 'Account', 'Debit', 'Credit'],
      ['', '01/15/2026', 'Deposit', '', 'Acme Corp', 'January work', 'Business Checking', '1,000.00', ''],
      ['', '', '', '', 'Acme Corp', '', 'Consulting Income', '', '1,000.00'],
      ['', '', '', '', '', '', '', '1,000.00', '1,000.00'],
      ['', '02/01/2026', 'Check', '101', 'Landlord', '', 'Rent', '400.00', ''],
      ['', '', '', '', '', '', 'Business Checking', '', '400.00'],
      ['', '', '', '', '', '', '', '400.00', '400.00'],
      ['TOTAL', '', '', '', '', '', '', '1,400.00', '1,400.00'],
    ];
    const { rows, problems } = parseJournal(grid);
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        date: '2026-01-15', type: 'Deposit', number: null, name: 'Acme Corp', memo: 'January work',
        lines: [
          { account: 'Business Checking', debit: '1000.00', credit: '0', memo: 'January work', name: 'Acme Corp' },
          { account: 'Consulting Income', debit: '0', credit: '1000.00', memo: null, name: 'Acme Corp' },
        ],
      },
      {
        date: '2026-02-01', type: 'Check', number: '101', name: 'Landlord', memo: null,
        lines: [
          { account: 'Rent', debit: '400.00', credit: '0', memo: null, name: 'Landlord' },
          { account: 'Business Checking', debit: '0', credit: '400.00', memo: null, name: null },
        ],
      },
    ]);
  });
});
