// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import JournalEntryEditor from './JournalEntryEditor';
import type { JournalEntryDetail } from './journalEntryTypes';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const NEW_ACCOUNT_ID = '99999999-9999-4999-8999-999999999999';

const { apiGet, apiPost, periodState } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  periodState: { include2024: false },
}));

vi.mock('@/lib/business', () => ({
  useActiveBusinessId: () => ['44444444-4444-4444-8444-444444444444'],
}));

vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({ user: { role: 'firm_admin' } }),
}));

vi.mock('@/lib/apiClient', () => ({
  api: {
    get: apiGet,
    post: apiPost,
  },
}));

const readOnlyEntry = {
  entry: {
    id: '33333333-3333-4333-8333-333333333333',
    business_id: '44444444-4444-4444-8444-444444444444',
    period_id: '55555555-5555-4555-8555-555555555555',
    period_status: 'open',
    entry_date: '2026-09-05',
    journal_number: '83',
    reference: null,
    memo: null,
    source_type: 'manual',
    source_id: null,
    status: 'voided',
    corrected_from_entry_id: null,
    reversed_entry_id: null,
    posted_at: '2026-09-05T12:00:00.000Z',
    posted_by_user_id: '66666666-6666-4666-8666-666666666666',
    voided_at: '2026-09-05T13:00:00.000Z',
    voided_by_user_id: '66666666-6666-4666-8666-666666666666',
    void_reason: 'Test fixture',
    created_at: '2026-09-05T12:00:00.000Z',
    created_by_user_id: '66666666-6666-4666-8666-666666666666',
    updated_at: '2026-09-05T13:00:00.000Z',
  },
  lines: [{
    id: '77777777-7777-4777-8777-777777777777',
    journal_entry_id: '33333333-3333-4333-8333-333333333333',
    line_number: 1,
    account_id: CASH_ID,
    account_code: '1010',
    account_name: 'Cash',
    debit: '10.0000',
    credit: '0.0000',
    memo: null,
    name: null,
    class_name: null,
  }],
  can_correct: false,
  correction_block_reason: 'This entry is read-only.',
  can_reverse: false,
  reversal_block_reason: 'This entry is read-only.',
  is_standalone_manual: true,
} satisfies JournalEntryDetail;

describe('JournalEntryEditor line keyboard navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    periodState.include2024 = false;
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockImplementation((url: string) => {
      if (url.endsWith('/coa')) {
        return Promise.resolve({
          data: {
            accounts: [{
              id: CASH_ID,
              code: '1010',
              name: 'Cash',
              account_type: 'asset',
              is_active: true,
              is_locked: false,
            }],
          },
        });
      }
      if (url.endsWith('/periods')) {
        return Promise.resolve({
          data: {
            periods: [
              {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                starts_on: '2026-01-01',
                ends_on: '2026-12-31',
                status: 'open',
              },
              ...(periodState.include2024 ? [{
                id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                starts_on: '2024-12-01',
                ends_on: '2024-12-31',
                status: 'open',
              }] : []),
            ],
          },
        });
      }
      return Promise.resolve({ data: { journal_number: '84' } });
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function renderEditor(existing?: JournalEntryDetail) {
    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <JournalEntryEditor {...(existing ? { existing } : {})} />
        </MemoryRouter>,
      );
    });
  }

  function dataRows() {
    return Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr.group'));
  }

  function classField(row: HTMLTableRowElement) {
    const fields = row.querySelectorAll<HTMLInputElement>('input');
    return fields[fields.length - 1]!;
  }

  async function pressTab(field: HTMLInputElement, shiftKey = false) {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => field.dispatchEvent(event));
    return event;
  }

  async function click(element: Element) {
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }

  function setFieldValue(field: HTMLInputElement | HTMLSelectElement, value: string) {
    const prototype = field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  }

  it('adds one row and focuses the labelled Account field after forward Tab on the final Class field', async () => {
    await renderEditor();
    const event = await pressTab(classField(dataRows()[7]!));

    expect(event.defaultPrevented).toBe(true);
    expect(dataRows()).toHaveLength(9);
    const firstNewAccount = container.querySelector<HTMLButtonElement>('#journal-account-8');
    expect(firstNewAccount?.getAttribute('aria-label')).toBe('Account, line 9');
    expect(document.activeElement).toBe(firstNewAccount);
  });

  it('moves focus to the Debits box in the same row when tabbing out of an open Account search', async () => {
    await renderEditor();
    const row = dataRows()[0]!;
    await click(container.querySelector('#journal-account-0')!);

    // Open state swaps the trigger button for a search input.
    const search = row.querySelector<HTMLInputElement>('input[aria-label="Account, line 1"]')!;
    expect(document.activeElement).toBe(search);

    const event = await pressTab(search);

    expect(event.defaultPrevented).toBe(true);
    const debits = row.querySelectorAll<HTMLInputElement>('input[type="number"]')[0]!;
    expect(document.activeElement).toBe(debits);
  });

  it('returns focus to the Account trigger after picking an account with Enter', async () => {
    await renderEditor();
    const row = dataRows()[0]!;
    await click(container.querySelector('#journal-account-0')!);
    const search = row.querySelector<HTMLInputElement>('input[aria-label="Account, line 1"]')!;

    await act(async () => search.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    })));

    expect(document.activeElement).toBe(container.querySelector('#journal-account-0'));
  });

  it('does not add rows on Shift+Tab or from a non-final Class field', async () => {
    await renderEditor();

    expect((await pressTab(classField(dataRows()[7]!), true)).defaultPrevented).toBe(false);
    expect((await pressTab(classField(dataRows()[6]!))).defaultPrevented).toBe(false);
    expect(dataRows()).toHaveLength(8);
  });

  it('does not add rows to a read-only journal entry', async () => {
    await renderEditor(readOnlyEntry);
    const finalClass = classField(dataRows()[7]!);

    expect(container.querySelector('#journal-account-0')?.getAttribute('aria-label'))
      .toBe('Account, line 1: 1010 Cash');
    expect(finalClass.disabled).toBe(true);
    expect((await pressTab(finalClass)).defaultPrevented).toBe(false);
    expect(dataRows()).toHaveLength(8);
  });

  it('lets a firm admin create periods for an uncovered journal date', async () => {
    apiPost.mockImplementation((url: string) => {
      if (url.endsWith('/periods/seed-year')) {
        periodState.include2024 = true;
        return Promise.resolve({
          data: {
            periods: [{
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              starts_on: '2024-12-01',
              ends_on: '2024-12-31',
              status: 'open',
            }],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    await renderEditor();

    const date = container.querySelector<HTMLInputElement>('input[type="date"]')!;
    await act(async () => {
      date.focus();
      setFieldValue(date, '2024-12-31');
      date.blur();
    });

    expect(container.textContent).toContain('No fiscal period covers 12/31/2024.');
    const createPeriods = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Create 2024 periods');
    expect(createPeriods).toBeDefined();
    await click(createPeriods!);

    expect(apiPost).toHaveBeenCalledWith(
      '/businesses/44444444-4444-4444-8444-444444444444/periods/seed-year',
      { year: 2024 },
    );
    expect(container.textContent).not.toContain('No fiscal period covers 12/31/2024.');
  });

  it('creates and selects a new account from the Account dropdown', async () => {
    apiPost.mockResolvedValue({
      data: {
        id: NEW_ACCOUNT_ID,
        code: '6990',
        name: 'Miscellaneous Expense',
        account_type: 'expense',
        is_active: true,
        is_locked: false,
      },
    });
    await renderEditor();
    await click(container.querySelector('#journal-account-0')!);

    const accountList = document.querySelector('[role="listbox"]');
    expect(accountList).not.toBeNull();
    expect(container.contains(accountList)).toBe(false);

    const addAccount = Array.from(document.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Add new account');
    expect(addAccount).toBeDefined();
    await click(addAccount!);

    const drawer = document.querySelector('[role="dialog"][aria-label="New account"]');
    expect(drawer).not.toBeNull();
    expect(drawer?.textContent).toContain('Detail type');
    expect(drawer?.textContent).toContain('Make this a subaccount');
    expect(drawer?.textContent).toContain('Lock account');

    const code = document.querySelector<HTMLInputElement>('#new-account-code')!;
    const name = document.querySelector<HTMLInputElement>('#new-account-name')!;
    const type = document.querySelector<HTMLButtonElement>('#new-account-type')!;
    await click(type);
    const typeMenu = document.querySelector('[role="menu"][aria-label="Account type choices"]');
    expect(typeMenu).not.toBeNull();
    expect(Array.from(typeMenu!.querySelectorAll('[data-account-type-group]')).map(item => item.textContent))
      .toEqual(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']);
    expect(Array.from(typeMenu!.querySelectorAll<HTMLButtonElement>('button')).map(button => button.textContent?.trim()))
      .toEqual([
        'Bank', 'Accounts receivable (A/R)', 'Other Current Assets', 'Fixed Assets', 'Other Assets',
        'Credit Card', 'Accounts payable (A/P)', 'Other Current Liabilities', 'Long Term Liabilities',
        'Equity', 'Income', 'Other Income', 'Cost of Goods Sold', 'Expenses', 'Other Expense',
      ]);
    const expensesType = Array.from(typeMenu!.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === 'Expenses');
    await click(expensesType!);
    const detailType = document.querySelector<HTMLSelectElement>('#new-account-detail-type')!;
    await act(async () => {
      setFieldValue(code, '6990');
      setFieldValue(name, 'Miscellaneous Expense');
      setFieldValue(detailType, 'Other Business Expenses');
    });
    await act(async () => document.querySelector<HTMLFormElement>('#coa-create-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    expect(apiPost).toHaveBeenCalledWith(
      '/businesses/44444444-4444-4444-8444-444444444444/coa',
      {
        code: '6990',
        name: 'Miscellaneous Expense',
        account_type: 'expense',
        detail_type: 'Other Business Expenses',
        description: null,
        parent_id: null,
        opening_balance: null,
        opening_balance_as_of: null,
        is_locked: false,
      },
    );
    expect(container.querySelector('#journal-account-0')?.getAttribute('aria-label'))
      .toBe('Account, line 1: 6990 Miscellaneous Expense');
  });

  it('disables Detail type until Account type is selected and shows only its mapped details', async () => {
    const expectedDetails: Record<string, string[]> = {
      'Bank': ['Cash on hand', 'Checking', 'Money Market', 'Rents Held in Trust', 'Savings', 'Trust account'],
      'Accounts receivable (A/R)': ['Accounts receivable (A/R)'],
      'Other Current Assets': ['Allowance for Bad Debts', 'Development Costs', 'Employee Cash Advances', 'Inventory', 'Investment - Mortgage/Real Estate Loans', 'Investment - Tax-Exempt Securities', 'Investment - U.S. Government Obligations', 'Investments - Other', 'Loans To Officers', 'Loans to Others', 'Loans to Stockholders', 'Other Current Assets', 'Prepaid Expenses', 'Retainage', 'Undeposited Funds'],
      'Fixed Assets': ['Accumulated Amortization', 'Accumulated Depletion', 'Accumulated Depreciation', 'Buildings', 'Depletable Assets', 'Fixed Asset Computers', 'Fixed Asset Copiers', 'Fixed Asset Furniture', 'Fixed Asset Other Tools Equipment', 'Fixed Asset Phone', 'Fixed Asset Photo Video', 'Fixed Asset Software', 'Furniture & Fixtures', 'Intangible Assets', 'Land', 'Leasehold Improvements', 'Machinery & Equipment', 'Other fixed assets', 'Vehicles'],
      'Other Assets': ['Accumulated Amortization of Other Assets', 'Goodwill', 'Lease Buyout', 'Licenses', 'Organizational Costs', 'Other Long-term Assets', 'Security Deposits'],
      'Credit Card': ['Credit Card'],
      'Accounts payable (A/P)': ['AP'],
      'Other Current Liabilities': ['Deferred Revenue', 'Federal Income Tax Payable', 'Insurance Payable', 'Line of Credit', 'Loan Payable', 'Other Current Liabilities', 'Payroll Clearing', 'Payroll Tax Payable', 'Prepaid Expenses Payable', 'Rents in trust - Liability', 'Sales Tax Payable', 'State/Local Income Tax Payable', 'Trust Accounts - Liabilities', 'Undistributed Tips'],
      'Long Term Liabilities': ['Notes Payable', 'Other Long Term Liabilities', 'Shareholder Notes Payable'],
      'Equity': ['Accumulated Adjustment', 'Common Stock', 'Estimated Taxes', 'Health Insurance Premium', 'Health Savings Account Contribution', 'Opening Balance Equity', "Owner's Equity", 'Paid-In Capital or Surplus', 'Partner Contributions', 'Partner Distributions', "Partner's Equity", 'Personal Expense', 'Personal Income', 'Preferred Stock', 'Retained Earnings', 'Treasury Stock'],
      'Income': ['Discounts/Refunds Given', 'Non-Profit Income', 'Other Primary Income', 'Sales of Product Income', 'Service/Fee Income', 'Unapplied Cash Payment Income'],
      'Other Income': ['Dividend Income', 'Interest Earned', 'Other Investment Income', 'Other Miscellaneous Income', 'Tax-Exempt Interest'],
      'Cost of Goods Sold': ['Cost of labor - COS', 'Equipment Rental - COS', 'Other Costs of Services - COS', 'Shipping, Freight & Delivery - COS', 'Supplies & Materials - COGS'],
      'Expenses': ['Advertising/Promotional', 'Auto', 'Bad Debts', 'Bank Charges', 'Charitable Contributions', 'Communication', 'Cost of Labor', 'Dues & subscriptions', 'Entertainment', 'Entertainment Meals', 'Equipment Rental', 'Finance costs', 'Insurance', 'Interest Paid', 'Legal & Professional Fees', 'Office/General Administrative Expenses', 'Other Business Expenses', 'Other Miscellaneous Service Cost', 'Payroll Expenses', 'Payroll Tax Expenses', 'Payroll Wage Expenses', 'Promotional Meals', 'Rent or Lease of Buildings', 'Repair & Maintenance', 'Shipping, Freight & Delivery', 'Supplies & Materials', 'Taxes Paid', 'Travel', 'Travel Meals', 'Unapplied Cash Bill Payment Expense', 'Utilities'],
      'Other Expense': ['Amortization', 'Depreciation', 'Exchange Gain or Loss', 'Gas And Fuel', 'Home Office', 'Homeowner Rental Insurance', 'Mortgage Interest Home Office', 'Other Home Office Expenses', 'Other Miscellaneous Expense', 'Other Vehicle Expenses', 'Parking and Tolls', 'Penalties & Settlements', 'Property Tax Home Office', 'Rent and Lease Home Office', 'Repairs and Maintenance Home Office', 'Utilities Home Office', 'Vehicle', 'Vehicle Insurance', 'Vehicle Lease', 'Vehicle Loan', 'Vehicle Loan Interest', 'Vehicle Registration', 'Vehicle Repairs', 'Wash and Road Services'],
    };

    await renderEditor();
    await click(container.querySelector('#journal-account-0')!);
    const addAccount = Array.from(document.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Add new account');
    await click(addAccount!);

    const accountType = document.querySelector<HTMLButtonElement>('#new-account-type')!;
    const detailType = document.querySelector<HTMLSelectElement>('#new-account-detail-type')!;
    expect(accountType.textContent?.trim()).toBe('Select account type');
    expect(detailType.disabled).toBe(true);

    for (const [typeLabel, details] of Object.entries(expectedDetails)) {
      await click(accountType);
      const choice = Array.from(document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="Account type choices"] button',
      )).find(button => button.textContent?.trim() === typeLabel);
      await click(choice!);

      expect(detailType.disabled).toBe(false);
      expect(detailType.value).toBe('');
      expect(Array.from(detailType.options).slice(1).map(option => option.textContent)).toEqual(details);
    }
  });
});
