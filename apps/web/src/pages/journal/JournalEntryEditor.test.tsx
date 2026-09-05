// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import JournalEntryEditor from './JournalEntryEditor';
import type { JournalEntryDetail } from './journalEntryTypes';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const NEW_ACCOUNT_ID = '99999999-9999-4999-8999-999999999999';

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));

vi.mock('@/lib/business', () => ({
  useActiveBusinessId: () => ['44444444-4444-4444-8444-444444444444'],
}));

vi.mock('@/lib/apiClient', () => ({
  api: {
    get: vi.fn((url: string) => Promise.resolve({
      data: url.endsWith('/coa')
        ? {
            accounts: [{
              id: CASH_ID,
              code: '1010',
              name: 'Cash',
              account_type: 'asset',
              is_active: true,
              is_locked: false,
            }],
          }
        : { journal_number: '84' },
    })),
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

  it('adds three rows and focuses the labelled Account field after forward Tab on the final Class field', async () => {
    await renderEditor();
    const event = await pressTab(classField(dataRows()[7]!));

    expect(event.defaultPrevented).toBe(true);
    expect(dataRows()).toHaveLength(11);
    const firstNewAccount = container.querySelector<HTMLButtonElement>('#journal-account-8');
    expect(firstNewAccount?.getAttribute('aria-label')).toBe('Account, line 9');
    expect(document.activeElement).toBe(firstNewAccount);
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

    const addAccount = Array.from(document.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Add new account');
    expect(addAccount).toBeDefined();
    await click(addAccount!);

    const code = document.querySelector<HTMLInputElement>('#new-journal-account-code')!;
    const name = document.querySelector<HTMLInputElement>('#new-journal-account-name')!;
    const type = document.querySelector<HTMLSelectElement>('#new-journal-account-type')!;
    await act(async () => {
      setFieldValue(code, '6990');
      setFieldValue(name, 'Miscellaneous Expense');
      setFieldValue(type, 'expense');
    });
    await act(async () => document.querySelector<HTMLFormElement>('#new-journal-account-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

    expect(apiPost).toHaveBeenCalledWith(
      '/businesses/44444444-4444-4444-8444-444444444444/coa',
      { code: '6990', name: 'Miscellaneous Expense', account_type: 'expense' },
    );
    expect(container.querySelector('#journal-account-0')?.getAttribute('aria-label'))
      .toBe('Account, line 1: 6990 Miscellaneous Expense');
  });
});
