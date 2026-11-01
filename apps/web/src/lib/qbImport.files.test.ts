import { describe, expect, it } from 'vitest';
import {
  firstPhone, parseAccounts, parseContacts, parseDate, parseItems, parseJournal, parseOpenItems, parseTrialBalance, parseUncleared,
  readGrid, splitAddress, type Grid,
} from './qbImport';
import {
  CUTOVER, RETAINED_EARNINGS, accountList, checkingReconciliation, customerContactList, journal, openInvoices, productServiceList,
  toCsv, toXlsx, trialBalance, unpaidBills, vendorContactList, visaTransactionDetail, type Sheet,
} from './qbImport.fixtures';

// A whole made-up client's QuickBooks exports, written as real Excel and CSV
// files and read back the way the page reads an upload.
const sum = (values: string[]) => Math.round(values.reduce((s, v) => s + Number(v), 0) * 100) / 100;

describe.each([
  ['Excel', (s: Sheet): Grid => readGrid(toXlsx(s))],
  ['CSV', (s: Sheet): Grid => readGrid(toCsv(s))],
])('QuickBooks exports saved as %s', (_kind, read) => {
  it('reads the account list, without the footer or anything made up', () => {
    const { rows, problems } = parseAccounts(read(accountList));
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(25);
    expect(rows.find(r => r.name === 'Equipment:Accumulated Depreciation')).toMatchObject({ account_type: 'asset', detail_type: 'Accumulated Depreciation' });
    expect(rows.find(r => r.name === 'Chase Visa')).toMatchObject({ account_type: 'liability', detail_type: 'Credit Card' });
    expect(rows.find(r => r.name === 'Cost of Goods Sold')).toMatchObject({ account_type: 'expense' });
    expect(rows.find(r => r.name === 'Depreciation')).toMatchObject({ account_type: 'expense', detail_type: 'Depreciation' });
    expect(rows.some(r => /basis|gmt/i.test(r.name))).toBe(false);
  });

  it('reads customers, taking apart a one-cell address and a list of phone numbers', () => {
    const { rows, problems } = parseContacts(read(customerContactList), 'Customers');
    expect(problems).toEqual([]);
    expect(rows.map(r => r.name)).toEqual(['Corner Market', 'Green Grocer Co', 'Hilltop Cafe', 'Hilltop Cafe:Catering', 'Riverside School District', 'Dana Lopez']);
    expect(rows[1]).toMatchObject({
      email: 'ap@greengrocer.example', phone: '(512) 555-0102',
      billing_address: { line1: '88 Market Ave, Suite 4', city: 'Austin', state: 'TX', postal_code: '78704', country: 'US' },
    });
    expect(rows[4]).toMatchObject({ phone: '512.555.0120 ext 12', billing_address: { line1: 'PO Box 77', city: 'Pflugerville', state: 'TX', postal_code: '78660-0077' } });
    expect(rows[5]).toMatchObject({ phone: null, billing_address: null });
  });

  it('reads vendors with their account numbers', () => {
    const { rows } = parseContacts(read(vendorContactList), 'Vendors');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ name: 'City Power & Light', account_number: '44-1029-3', billing_address: { line1: 'PO Box 1000', city: 'Austin', state: 'TX', postal_code: '78767' } });
  });

  it('reads products and services, their stock agreeing with the trial balance', () => {
    const { rows, problems } = parseItems(read(productServiceList));
    expect(problems).toEqual([]);
    expect(rows.map(r => r.name)).toEqual(['Sourdough Loaf', 'Croissant Box', 'Catering Service', 'Delivery']);
    expect(sum(rows.map(r => String(Number(r.quantity_on_hand ?? 0) * Number(r.purchase_cost ?? 0))))).toBe(160);
  });

  it('reads open invoices, a sub-customer under its parent, coming to Accounts Receivable', () => {
    const { rows, problems } = parseOpenItems(read(openInvoices), 'Open Invoices');
    expect(problems).toEqual([]);
    expect(rows.map(r => `${r.name} ${r.type} ${r.number ?? ''} ${r.amount}`)).toEqual([
      'Corner Market Invoice 1051 240',
      'Green Grocer Co Invoice 1046 480',
      'Green Grocer Co Payment  -100',
      'Hilltop Cafe:Catering Invoice 1050 900',
      // Back under the parent once the sub-customer's total has closed it.
      'Hilltop Cafe Invoice 1049 300',
      'Hilltop Cafe Credit Memo 1052 -50',
      'Riverside School District Invoice 1040 1250',
    ]);
    expect(rows[0]).toMatchObject({ date: '2026-10-20', due_date: '2026-11-04', terms: 'Net 15' });
    expect(sum(rows.map(r => r.amount))).toBe(3020);
  });

  it('reads unpaid bills from the open balance, coming to Accounts Payable', () => {
    const { rows, problems } = parseOpenItems(read(unpaidBills), 'Unpaid Bills');
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(5);
    expect(rows.find(r => r.number === 'VC-12')).toMatchObject({ name: 'Flour Mills Inc', type: 'Vendor Credit', amount: '-40' });
    expect(sum(rows.map(r => r.amount))).toBe(1315.5);
  });

  it('reads only the uncleared items of a reconciliation report, up to the cutover', () => {
    const { rows, problems, notes } = parseUncleared(read(checkingReconciliation), { cutover: CUTOVER, liability: false });
    expect(problems).toEqual([]);
    expect(rows.map(r => `${r.date} ${r.type} ${r.number ?? ''} ${r.amount}`)).toEqual([
      '2026-10-29 Check 1187 -86.40',
      '2026-10-30 Bill Payment 1188 -500.00',
      '2026-10-31 Deposit  735.00',
    ]);
    expect(notes).toEqual(['1 dated after the cutover date was left out: enter it here']);
  });

  it('reads a card\'s uncleared items from Transaction Detail by Account, charges as money out', () => {
    const { rows, problems, notes } = parseUncleared(read(visaTransactionDetail), { cutover: CUTOVER, liability: true });
    expect(problems).toEqual([]);
    expect(rows.map(r => `${r.date} ${r.name} ${r.amount}`)).toEqual([
      '2026-10-27 Packaging Plus -64.20',
      '2026-10-30 Flour Mills Inc -120.00',
      '2026-10-31 Packaging Plus 15.00',
    ]);
    expect(notes).toEqual(['1 cleared row was left out']);
  });

  it('reads the trial balance, balanced, with sub-accounts by their full names', () => {
    const { rows, problems } = parseTrialBalance(read(trialBalance));
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(21);
    expect(sum(rows.map(r => r.debit))).toBe(sum(rows.map(r => r.credit)));
    expect(rows.find(r => r.account === 'Retained Earnings')).toEqual({ account: 'Retained Earnings', debit: '0', credit: RETAINED_EARNINGS.toFixed(2) });
    expect(rows.find(r => r.account === 'Equipment:Accumulated Depreciation')).toEqual({ account: 'Equipment:Accumulated Depreciation', debit: '0', credit: '8400.00' });
  });

  it('reads the journal into balanced transactions', () => {
    const { rows, problems } = parseJournal(read(journal));
    expect(problems).toEqual([]);
    expect(rows.map(t => `${t.date} ${t.type} ${t.lines.length}`)).toEqual([
      '2026-10-01 Check 2', '2026-10-05 Bill 2', '2026-10-15 Expense 2', '2026-10-16 Deposit 3', '2026-10-29 Check 2',
    ]);
    for (const t of rows) expect(sum(t.lines.map(l => l.debit))).toBe(sum(t.lines.map(l => l.credit)));
  });
});

describe('QuickBooks export details', () => {
  it('reads the date forms an export can have', () => {
    expect(parseDate('10-31-2026')).toBe('2026-10-31');
    expect(parseDate('Oct 31, 2026')).toBe('2026-10-31');
    expect(parseDate('October 5 2026')).toBe('2026-10-05');
    expect(parseDate('31-Oct-26')).toBe('2026-10-31');
    expect(parseDate('5 Sept 2026')).toBe('2026-09-05');
    expect(parseDate('46326')).toBe('2026-10-31');
    expect(parseDate('Octember 5, 2026')).toBeNull();
    expect(parseDate('1047')).toBeNull();
  });

  it('takes an address apart only when it reads as one', () => {
    expect(splitAddress('1 Main St, Austin, TX 78701')).toEqual({ line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78701' });
    expect(splitAddress('1 Main St Austin TX 78701')).toEqual({ line1: '1 Main St Austin TX 78701' });
    expect(splitAddress('20 King St W, Toronto, ON M5H 1C4, Canada')).toEqual({ line1: '20 King St W', city: 'Toronto', state: 'ON', postal_code: 'M5H 1C4', country: 'Canada' });
    expect(firstPhone('Mobile: +1 512-555-0100')).toBe('+1 512-555-0100');
    expect(firstPhone('ask at the front')).toBe('ask at the front');
  });

  it('says so when a date column holds something that is not a date', () => {
    const grid = [['', 'Date', 'Transaction Type', 'Num', 'Open Balance'], ['Acme'], ['', '31.10.2026', 'Invoice', '7', '5.00']];
    expect(parseOpenItems(grid, 'Open Invoices').problems).toEqual(['"31.10.2026" in the Date column isn\'t a date this page can read']);
  });

  it('skips an account list\'s type headings, but not an account with no type', () => {
    const grid = [['Account', 'Type'], ['Bank'], ['Checking', 'Bank'], ['Orphan']];
    const { rows, problems } = parseAccounts(grid);
    expect(rows.map(r => r.name)).toEqual(['Checking']);
    expect(problems).toEqual(['Orphan: QuickBooks type "" isn\'t one this page knows']);
  });

  it('reads a card register\'s charge and payment columns the card\'s way round', () => {
    const grid = [['Date', 'Payee', 'Charge', 'Payment'], ['10/30/2026', 'Shop', '40.00', ''], ['10/31/2026', 'Bank', '', '100.00']];
    expect(parseUncleared(grid, { liability: true }).rows.map(r => r.amount)).toEqual(['-40.00', '100.00']);
    const bank = [['Date', 'Payee', 'Payment', 'Deposit'], ['10/30/2026', 'Shop', '40.00', ''], ['10/31/2026', 'Bank', '', '100.00']];
    expect(parseUncleared(bank, { liability: false }).rows.map(r => r.amount)).toEqual(['-40.00', '100.00']);
  });
});
