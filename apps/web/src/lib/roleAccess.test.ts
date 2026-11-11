import { describe, expect, it } from 'vitest';
import { AREAS, type Level, type Permissions } from '@accounting/shared';
import { canOpenPage, customRoleRefusal, roleAtLeast, roleOnPage, type Access } from './roleAccess';

describe('canOpenPage', () => {
  it('gives a client the dashboard, its invoices and the financial reports', () => {
    for (const page of ['/', '/account', '/messages', '/documents/send', '/ap/bills', '/ap/bills/9c2b', '/invoices', '/invoices/1f0e', '/reports/pnl', '/reports/balance-sheet', '/reports/ap-aging']) {
      expect(canOpenPage('client', page), page).toBe(true);
    }
  });

  it('keeps a client out of everything else, including the form that writes an invoice', () => {
    for (const page of ['/invoices/new', '/ap/bills/new', '/ap/vendors', '/customers', '/payroll/employees', '/ai/inbox', '/accounting/bank-transactions',
      '/reports/general-ledger', '/reports/1099', '/setup/users', '/journal/new']) {
      expect(canOpenPage('client', page), page).toBe(false);
    }
  });

  it('keeps firm-admin pages for the firm admin', () => {
    for (const page of ['/firm', '/setup/users', '/clients/new', '/accounting/client-overview']) {
      expect(canOpenPage('firm_admin', page), page).toBe(true);
      expect(canOpenPage('accountant', page), page).toBe(false);
      expect(canOpenPage('staff', page), page).toBe(false);
    }
  });

  it('closes the forms only an accountant can save to staff', () => {
    for (const page of ['/journal/new', '/accounting/transfers/new', '/credit-memos/new', '/ap/vendor-credits/new', '/ap/pay-bills', '/payroll/pay-runs/new']) {
      expect(canOpenPage('staff', page), page).toBe(false);
      expect(canOpenPage('accountant', page), page).toBe(true);
    }
    expect(canOpenPage('accountant', '/payroll/employees/new')).toBe(false);
    expect(canOpenPage('firm_admin', '/payroll/employees/new')).toBe(true);
  });

  it('keeps the activity log for an accountant and up', () => {
    expect(canOpenPage('staff', '/setup/activity')).toBe(false);
    expect(canOpenPage('accountant', '/setup/activity')).toBe(true);
    expect(canOpenPage('firm_admin', '/setup/activity')).toBe(true);
  });

  it('keeps the client upload page for clients; the firm uploads from the AI inbox', () => {
    expect(canOpenPage('staff', '/documents/send')).toBe(false);
    expect(canOpenPage('firm_admin', '/documents/send')).toBe(false);
  });

  it('opens the rest of the app to staff and accountants', () => {
    for (const page of ['/', '/messages', '/invoices/new', '/ap/bills/new', '/payroll/pay-runs', '/ai/inbox', '/settings/tax-codes']) {
      expect(canOpenPage('staff', page), page).toBe(true);
      expect(canOpenPage('accountant', page), page).toBe(true);
    }
  });

  it('lets a view-only login open every page but the forms that add something', () => {
    for (const page of ['/', '/invoices', '/payroll/employees', '/ai/inbox', '/reports/general-ledger', '/journal/3f9a']) {
      expect(canOpenPage('viewer', page), page).toBe(true);
    }
    for (const page of ['/invoices/new', '/journal/new', '/accounting/bank-transactions/import', '/setup/users', '/setup/activity']) {
      expect(canOpenPage('viewer', page), page).toBe(false);
    }
  });

  it('closes payroll to a login it was switched off for, whatever the role', () => {
    const off = { payroll: false };
    expect(canOpenPage('accountant', '/payroll/pay-runs', off)).toBe(false);
    expect(canOpenPage('staff', '/payroll/employees/3f9a', off)).toBe(false);
    expect(canOpenPage('accountant', '/invoices', off)).toBe(true);
    expect(canOpenPage('accountant', '/payroll/pay-runs')).toBe(true);
  });

  it('opens nothing before the user has loaded', () => {
    expect(canOpenPage(null, '/')).toBe(false);
  });
});

describe('roleAtLeast', () => {
  it('compares against the role ladder', () => {
    expect(roleAtLeast('accountant', 'staff')).toBe(true);
    expect(roleAtLeast('staff', 'accountant')).toBe(false);
    expect(roleAtLeast('viewer', 'staff')).toBe(false);
    expect(roleAtLeast('viewer', 'client')).toBe(true);
    expect(roleAtLeast(null, 'client')).toBe(false);
  });
});

describe('a custom role on a page (docs/specs/2026-11-09-custom-roles-design.md)', () => {
  const all = (level: Level) => Object.fromEntries(AREAS.map(area => [area, level])) as Permissions;
  const access = (permissions: Permissions): Access => ({ kind: 'custom', role: { id: 'r1', name: 'Bookkeeper', permissions } });
  const open = (a: Access, page: string) => canOpenPage(roleOnPage(a, page), page);

  it('opens a page at the level of its area, and none where the area is closed', () => {
    const bookkeeper = access({ ...all('enter'), payroll: 'none', accounting: 'post' });
    expect(open(bookkeeper, '/ap/bills/new')).toBe(true);
    expect(open(bookkeeper, '/payroll/employees')).toBe(false);
    // Journal entries are an accountant's form: Post in Accounting opens it.
    expect(open(bookkeeper, '/journal/new')).toBe(true);
    // Pay Bills is an accountant's form in Expenses & bills, where this role only enters.
    expect(open(bookkeeper, '/ap/pay-bills')).toBe(false);
    expect(roleOnPage(bookkeeper, '/invoices')).toBe('staff');
  });

  it('never opens the firm\'s own pages, even at Full everywhere', () => {
    for (const page of ['/setup/users', '/setup/roles', '/firm', '/clients/new']) expect(open(access(all('full')), page), page).toBe(false);
    // Full in an area is a firm admin there: adding an employee.
    expect(open(access(all('full')), '/payroll/employees/new')).toBe(true);
  });

  it('a view level opens lists but not the forms that add', () => {
    const viewer = access({ ...all('none'), sales: 'view' });
    expect(open(viewer, '/invoices')).toBe(true);
    expect(open(viewer, '/invoices/new')).toBe(false);
    expect(open(viewer, '/')).toBe(true);
    expect(open(access(all('none')), '/')).toBe(false);
  });

  it('says which area a closed page needs', () => {
    expect(customRoleRefusal(access(all('none')), '/payroll/pay-runs')).toMatch(/Bookkeeper, has no access to Payroll/);
    expect(customRoleRefusal({ kind: 'builtin', role: 'staff' }, '/payroll')).toBeNull();
  });
});
