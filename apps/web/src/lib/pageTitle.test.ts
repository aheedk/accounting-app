import { describe, expect, it } from 'vitest';
import { documentTitle, pageName } from './pageTitle';

describe('pageName', () => {
  it('names a page that is listed', () => {
    expect(pageName('/reports/pnl')).toBe('Profit & Loss');
    expect(pageName('/')).toBe('Dashboard');
    expect(pageName('/reports/standard/')).toBe('Reports');
  });

  it('names a new record and an open one after their list', () => {
    expect(pageName('/invoices/new')).toBe('New Invoice');
    expect(pageName('/accounting/checks/4b1f0c1e-0000-4000-8000-000000000001')).toBe('Check');
    expect(pageName('/journal/new')).toBe('New Journal Entry');
  });

  it('lets a listed page win over the record rule', () => {
    expect(pageName('/accounting/reconcile/history')).toBe('Reconciliation History');
  });

  it('reads an unlisted address made of words, and gives up on an id', () => {
    expect(pageName('/somewhere/year-end-close')).toBe('Year End Close');
    expect(pageName('/somewhere/4b1f0c1e-0000-4000-8000-000000000001')).toBeNull();
    expect(pageName('/settings/coa/abc123/register')).toBe('Account Register');
  });
});

describe('documentTitle', () => {
  it('puts the page before the company', () => {
    expect(documentTitle('/reports/balance-sheet', 'Green Gadgets')).toBe('Balance Sheet - Green Gadgets');
  });

  it('falls back to the app name', () => {
    expect(documentTitle('/reports/balance-sheet', '')).toBe('Balance Sheet - Accounting App');
    expect(documentTitle('/x/123', 'Green Gadgets')).toBe('Green Gadgets');
  });
});
