// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import VendorDetailPage from './VendorDetailPage';

const { apiGet, apiDelete, navigate } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiDelete: vi.fn(),
  navigate: vi.fn(),
}));

let authRole = 'firm_admin';

vi.mock('@/lib/business', () => ({
  useActiveBusinessId: () => ['44444444-4444-4444-8444-444444444444'],
}));

vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({ user: { role: authRole }, businesses: [{ id: '44444444-4444-4444-8444-444444444444', role_override: null }] }),
}));

vi.mock('@/lib/apiClient', () => ({
  api: { get: apiGet, delete: apiDelete },
}));

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

function vendor(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'v2', name: 'Clean Vendor', company_name: null, email: null, email_cc: null, phone: null,
    mobile: null, fax: null, other_phone: null, website: null, name_on_checks: null,
    billing_address: null, notes: null, account_number: null, default_expense_account_id: null,
    opening_balance: null, opening_balance_as_of: null, tax_id_last_four: null, tax_id_type: null,
    is_1099: false, is_active: true, default_terms_days: 30, has_transactions: false,
    ...overrides,
  };
}

describe('VendorDetailPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    authRole = 'firm_admin';
    apiGet.mockReset();
    apiDelete.mockReset();
    navigate.mockReset();
    apiDelete.mockResolvedValue({ data: {} });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  async function render(v = vendor()) {
    apiGet.mockImplementation((url: string) => {
      if (url.endsWith('/vendors/v2')) return Promise.resolve({ data: v });
      if (url.endsWith('/bills')) return Promise.resolve({ data: { bills: [] } });
      if (url.endsWith('/coa')) return Promise.resolve({ data: { accounts: [] } });
      return Promise.resolve({ data: {} });
    });
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/ap/vendors/v2']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes><Route path="/ap/vendors/:id" element={<VendorDetailPage />} /></Routes>
        </MemoryRouter>,
      );
    });
  }

  async function click(element: Element) {
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }

  function deleteButton() {
    return Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Delete') as HTMLButtonElement;
  }

  it('deletes a vendor with no transactions and returns to the vendor list', async () => {
    await render();
    expect(deleteButton().disabled).toBe(false);

    await click(deleteButton());

    expect(window.confirm).toHaveBeenCalledWith('Permanently delete Clean Vendor? This cannot be undone.');
    expect(apiDelete).toHaveBeenCalledWith('/businesses/44444444-4444-4444-8444-444444444444/vendors/v2');
    expect(navigate).toHaveBeenCalledWith('/ap/vendors');
  });

  it('grays out Delete with an explanatory title when the vendor has transactions', async () => {
    await render(vendor({ has_transactions: true }));

    expect(deleteButton().disabled).toBe(true);
    expect(deleteButton().title).toMatch(/existing transactions/i);
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('requires firm_admin: an accountant sees Delete disabled', async () => {
    authRole = 'accountant';
    await render();

    expect(deleteButton().disabled).toBe(true);
    expect(deleteButton().title).toMatch(/firm admin/i);
  });

  it('shows the 409 error inline without navigating away on failure', async () => {
    apiDelete.mockRejectedValue({ response: { data: { error: { message: 'Cannot delete — vendor has existing transactions. Use "Make inactive" instead.' } } } });
    await render();

    await click(deleteButton());

    expect(container.textContent).toContain('Cannot delete — vendor has existing transactions');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows an Inactive badge next to the name for a deactivated vendor', async () => {
    await render(vendor({ is_active: false }));
    expect(container.textContent).toContain('Inactive');
  });
});
