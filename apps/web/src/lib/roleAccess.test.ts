import { describe, expect, it } from 'vitest';
import { canOpenPage, roleAtLeast } from './roleAccess';

describe('canOpenPage', () => {
  it('gives a client the dashboard, its invoices and the financial reports', () => {
    for (const page of ['/', '/account', '/invoices', '/invoices/1f0e', '/reports/pnl', '/reports/balance-sheet', '/reports/ap-aging']) {
      expect(canOpenPage('client', page), page).toBe(true);
    }
  });

  it('keeps a client out of everything else, including the form that writes an invoice', () => {
    for (const page of ['/invoices/new', '/customers', '/payroll/employees', '/ai/inbox', '/accounting/bank-transactions',
      '/reports/general-ledger', '/reports/1099', '/setup/users', '/journal/new']) {
      expect(canOpenPage('client', page), page).toBe(false);
    }
  });

  it('keeps firm-admin pages for the firm admin', () => {
    for (const page of ['/setup/users', '/clients/new', '/accounting/client-overview']) {
      expect(canOpenPage('firm_admin', page), page).toBe(true);
      expect(canOpenPage('accountant', page), page).toBe(false);
      expect(canOpenPage('staff', page), page).toBe(false);
    }
  });

  it('keeps the activity log for an accountant and up', () => {
    expect(canOpenPage('staff', '/setup/activity')).toBe(false);
    expect(canOpenPage('accountant', '/setup/activity')).toBe(true);
    expect(canOpenPage('firm_admin', '/setup/activity')).toBe(true);
  });

  it('opens the rest of the app to staff and accountants', () => {
    for (const page of ['/', '/invoices/new', '/payroll/pay-runs', '/ai/inbox', '/settings/tax-codes']) {
      expect(canOpenPage('staff', page), page).toBe(true);
      expect(canOpenPage('accountant', page), page).toBe(true);
    }
  });

  it('opens nothing before the user has loaded', () => {
    expect(canOpenPage(null, '/')).toBe(false);
  });
});

describe('roleAtLeast', () => {
  it('compares against the role ladder', () => {
    expect(roleAtLeast('accountant', 'staff')).toBe(true);
    expect(roleAtLeast('staff', 'accountant')).toBe(false);
    expect(roleAtLeast(null, 'client')).toBe(false);
  });
});
