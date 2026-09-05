// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ProfitLossPage from './ProfitLossPage';

vi.mock('@/lib/business', () => ({
  useActiveBusinessId: () => ['44444444-4444-4444-8444-444444444444'],
}));

vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({ businesses: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Demo Company' }] }),
}));

vi.mock('@/lib/apiClient', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({
      data: {
        period_start: '2026-09-01',
        period_end: '2026-09-30',
        revenue_lines: [{
          account_id: '11111111-1111-4111-8111-111111111111',
          account_code: '4100',
          account_name: 'Services',
          amount: '10675.00',
        }],
        revenue_total: '10675.00',
        expense_lines: [],
        expense_total: '0.00',
        gross_profit: '10675.00',
        operating_expenses_total: '0.00',
        operating_income: '10675.00',
        other_expenses_total: '0.00',
        net_income: '10675.00',
      },
    })),
  },
}));

describe('ProfitLossPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it('shows profit totals in accounting order', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ProfitLossPage />
        </MemoryRouter>,
      );
    });

    const labels = Array.from(container.querySelectorAll('tbody tr')).map(row => (
      row.querySelector('td')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    ));

    expect(labels).toEqual([
      'Income',
      '4100Services',
      'Total Income',
      'GROSS PROFIT',
      'Expenses',
      'No expenses recorded.',
      'Total Expenses',
      'NET OPERATING INCOME',
      'NET INCOME',
    ]);
  });
});
