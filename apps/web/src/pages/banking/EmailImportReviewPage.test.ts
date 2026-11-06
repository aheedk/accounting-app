import { describe, expect, it } from 'vitest';
import { bestVendorMatch, nextBankSort, sortableStatementDate, statementBankAccounts } from './EmailImportReviewPage';

// 2026-10-05 meeting follow-up: the bank account picker on a statement listed
// most of the chart; it should list bank accounts only.
describe('statementBankAccounts', () => {
  const accounts = [
    { id: 'chk', code: '1000', name: 'Operating', account_type: 'asset', detail_type: 'Checking' },
    { id: 'sav', code: '1010', name: 'Savings', account_type: 'asset', detail_type: 'Savings' },
    { id: 'old', code: '1020', name: 'Old Bank', account_type: 'asset', detail_type: null },
    { id: 'ar', code: '1100', name: 'Accounts Receivable', account_type: 'asset', detail_type: 'Accounts receivable (A/R)' },
    { id: 'equip', code: '1500', name: 'Equipment', account_type: 'asset', detail_type: 'Machinery & Equipment' },
    { id: 'susp', code: '1999', name: 'Suspense', account_type: 'asset', detail_type: 'Suspense' },
    { id: 'card', code: '2100', name: 'Amex', account_type: 'liability', detail_type: 'Credit Card' },
  ];
  const ids = (list: Array<{ id: string }>) => list.map(a => a.id);

  it('lists only accounts of type Bank', () => {
    expect(ids(statementBankAccounts(accounts, new Set(), ''))).toEqual(['chk', 'sav']);
  });

  it('also lists an account set up under Banking, whatever its detail type', () => {
    expect(ids(statementBankAccounts(accounts, new Set(['old']), ''))).toEqual(['chk', 'sav', 'old']);
  });

  it('keeps the account already chosen in the list', () => {
    expect(ids(statementBankAccounts(accounts, new Set(), 'equip'))).toEqual(['chk', 'sav', 'equip']);
  });

  it('falls back to the assets that may hold money when no account is marked as a bank', () => {
    // Not Suspense, and not receivables or equipment (item 39: Equipment showed in this picker).
    const unmarked = accounts.filter(a => a.id !== 'chk' && a.id !== 'sav');
    expect(ids(statementBankAccounts(unmarked, new Set(), ''))).toEqual(['old']);
  });

  it('leaves out equipment even when it was set up under Banking', () => {
    expect(ids(statementBankAccounts(accounts, new Set(['equip']), ''))).toEqual(['chk', 'sav']);
  });
});

// 2026-10-01 meeting follow-up: the Name column on a bank statement review
// should match what the AI pulled off the statement ("Duke Power") against
// the client's existing vendors ("Duke Energy") instead of leaving it as
// whatever the bank printed.
describe('bestVendorMatch', () => {
  const vendors = [
    { id: '1', name: 'Duke Energy' },
    { id: '2', name: 'Staples Inc' },
    { id: '3', name: 'Verizon Wireless' },
  ];

  it('matches a renamed vendor by shared, meaningful words', () => {
    expect(bestVendorMatch('Duke Power', vendors)).toBe('Duke Energy');
  });

  it('prefers an exact (case-insensitive) match over a fuzzy one', () => {
    expect(bestVendorMatch('staples inc', vendors)).toBe('Staples Inc');
  });

  it('ignores common business suffixes when comparing', () => {
    expect(bestVendorMatch('Staples', vendors)).toBe('Staples Inc');
  });

  it('returns null for an unrelated name rather than guessing', () => {
    expect(bestVendorMatch('Acme Plumbing', vendors)).toBeNull();
  });

  it('returns null for blank input or an empty vendor list', () => {
    expect(bestVendorMatch('', vendors)).toBeNull();
    expect(bestVendorMatch('Duke Power', [])).toBeNull();
  });
});

// Item 105, 11-05: sort by any column heading, as in the General Ledger.
describe('sortableStatementDate', () => {
  it('turns a statement date into one that sorts chronologically, not as text', () => {
    expect(sortableStatementDate('03/14/2026')).toBe('2026-03-14');
    expect(sortableStatementDate('1/5/2026')).toBe('2026-01-05');
    // Text order would put December before January across a year boundary; this must not.
    expect([sortableStatementDate('12/20/2025'), sortableStatementDate('01/05/2026')].sort())
      .toEqual(['2025-12-20', '2026-01-05']);
  });
});

describe('nextBankSort', () => {
  it('cycles ascending, then descending, then back to the order it came in', () => {
    const asc = nextBankSort(null, 'date');
    expect(asc).toEqual({ column: 'date', direction: 'asc' });
    const desc = nextBankSort(asc, 'date');
    expect(desc).toEqual({ column: 'date', direction: 'desc' });
    expect(nextBankSort(desc, 'date')).toBeNull();
  });

  it('starts a different column over at ascending', () => {
    const dateDesc = nextBankSort({ column: 'date', direction: 'desc' }, 'amount');
    expect(dateDesc).toEqual({ column: 'amount', direction: 'asc' });
  });
});
