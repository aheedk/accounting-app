// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import VendorListPage from './VendorListPage';

const { apiGet, apiPatch, apiDelete } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

let authRole = 'firm_admin';

vi.mock('@/lib/business', () => ({
  useActiveBusinessId: () => ['44444444-4444-4444-8444-444444444444'],
}));

vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({ user: { role: authRole }, businesses: [{ id: '44444444-4444-4444-8444-444444444444', role_override: null }] }),
}));

vi.mock('@/lib/apiClient', () => ({
  api: { get: apiGet, patch: apiPatch, delete: apiDelete },
}));

const VENDORS = [
  { id: 'v1', name: 'Has Transactions Co', email: null, phone: null, default_terms_days: 30, is_1099: false, is_active: true, has_transactions: true },
  { id: 'v2', name: 'Clean Vendor', email: null, phone: null, default_terms_days: 30, is_1099: false, is_active: true, has_transactions: false },
];

describe('VendorListPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    authRole = 'firm_admin';
    apiGet.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    apiPatch.mockResolvedValue({ data: {} });
    apiDelete.mockResolvedValue({ data: {} });
    apiGet.mockImplementation((url: string) => {
      if (url.endsWith('/vendors')) return Promise.resolve({ data: { vendors: VENDORS } });
      if (url.endsWith('/bills')) return Promise.resolve({ data: { bills: [] } });
      return Promise.resolve({ data: {} });
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  async function render() {
    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <VendorListPage />
        </MemoryRouter>,
      );
    });
  }

  async function click(element: Element) {
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }

  function rowCheckbox(name: string) {
    const row = Array.from(container.querySelectorAll('tbody tr')).find(tr => tr.textContent?.includes(name))!;
    return row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  }

  it('shows the batch actions bar once a row is selected, with the right count', async () => {
    await render();
    expect(container.textContent).not.toContain('selected');

    await click(rowCheckbox('Clean Vendor'));

    expect(container.textContent).toContain('1 vendor selected');
    expect(container.querySelector('button')?.textContent).toBeDefined();
  });

  it('batch "Make inactive" confirms, PATCHes every selected vendor, and reloads', async () => {
    await render();
    await click(rowCheckbox('Has Transactions Co'));
    await click(rowCheckbox('Clean Vendor'));
    expect(container.textContent).toContain('2 vendors selected');

    const batchToggle = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Batch actions'))!;
    await click(batchToggle);
    const makeInactive = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Make inactive')!;
    await click(makeInactive);

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Make 2 vendors inactive?'));
    expect(apiPatch).toHaveBeenCalledWith('/businesses/44444444-4444-4444-8444-444444444444/vendors/v1', { is_active: false });
    expect(apiPatch).toHaveBeenCalledWith('/businesses/44444444-4444-4444-8444-444444444444/vendors/v2', { is_active: false });
  });

  function openRowMenu(name: string) {
    const row = Array.from(container.querySelectorAll('tbody tr')).find(tr => tr.textContent?.includes(name))!;
    const trigger = row.querySelector<HTMLButtonElement>('button[aria-label^="More actions"]')!;
    return click(trigger);
  }

  it('grays out Delete with an explanatory title when the vendor has transactions', async () => {
    await render();
    await openRowMenu('Has Transactions Co');

    const deleteButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Delete')!;
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.title).toMatch(/existing transactions/i);
  });

  it('deletes a vendor with no transactions after confirming', async () => {
    await render();
    await openRowMenu('Clean Vendor');

    const deleteButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Delete')!;
    expect(deleteButton.disabled).toBe(false);
    await click(deleteButton);

    expect(window.confirm).toHaveBeenCalledWith('Permanently delete Clean Vendor? This cannot be undone.');
    expect(apiDelete).toHaveBeenCalledWith('/businesses/44444444-4444-4444-8444-444444444444/vendors/v2');
  });

  it('disables Make inactive and Delete for a role below the required minimum', async () => {
    authRole = 'staff';
    await render();
    await openRowMenu('Clean Vendor');

    const makeInactive = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Make inactive')!;
    const deleteButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Delete')!;
    expect(makeInactive.disabled).toBe(true);
    expect(deleteButton.disabled).toBe(true);
  });

  it('requests inactive vendors only when "Show inactive vendors" is checked', async () => {
    await render();
    const toggle = Array.from(container.querySelectorAll('input[type="checkbox"]'))
      .find(el => el.closest('label')?.textContent?.includes('Show inactive vendors')) as HTMLInputElement;

    await act(async () => {
      toggle.click();
    });

    expect(apiGet).toHaveBeenCalledWith(
      '/businesses/44444444-4444-4444-8444-444444444444/vendors',
      { params: { include_inactive: 'true' } },
    );
  });
});
