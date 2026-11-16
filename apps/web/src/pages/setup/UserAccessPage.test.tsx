// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import UserAccessPage from './UserAccessPage';

const { apiGet, apiPost, apiPatch, apiDelete, setActiveBusiness, navigate } = vi.hoisted(() => ({
  apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(),
  setActiveBusiness: vi.fn(), navigate: vi.fn(),
}));

vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', role: 'firm_admin' }, businesses: [] }),
}));

vi.mock('@/lib/business', () => ({
  useActiveBusinessId: () => [null, setActiveBusiness],
}));

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/lib/apiClient', () => ({
  api: { get: apiGet, post: apiPost, patch: apiPatch, delete: apiDelete },
}));

// The Radix menu does not open under jsdom (it hangs), so its items render in
// place — same mock VendorDetailPage.test.tsx and UsersPage.test.tsx use.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, disabled, onSelect }: {
    children: ReactNode; disabled?: boolean; onSelect?: (e: { preventDefault: () => void }) => void; className?: string;
  }) => (
    <div role="menuitem" aria-disabled={disabled ? 'true' : undefined}
      onClick={() => { if (!disabled) onSelect?.({ preventDefault: () => {} }); }}>
      {children}
    </div>
  ),
}));

const pat = {
  id: 'pat', email: 'pat@firm.test', full_name: 'Pat Lee', role: 'staff', custom_role: null,
  business_access: [{ business_id: 'biz-1', business_name: 'Green Gadgets', role_override: 'accountant', custom_role: null }],
};

describe('UserAccessPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('confirm', vi.fn(() => true));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    apiGet.mockImplementation((url: string) => {
      if (url === '/me/firm/users') return Promise.resolve({ data: { users: [pat] } });
      if (url === '/me') return Promise.resolve({ data: { businesses: [{ id: 'biz-1', name: 'Green Gadgets' }, { id: 'biz-2', name: 'Blue Widget Co.' }] } });
      if (url === '/me/firm/roles') return Promise.resolve({ data: { roles: [] } });
      return Promise.resolve({ data: {} });
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(userId = 'pat') {
    await act(async () => root.render(
      <MemoryRouter initialEntries={[`/setup/users/${userId}/access`]}>
        <Routes><Route path="/setup/users/:userId/access" element={<UserAccessPage />} /></Routes>
      </MemoryRouter>,
    ));
    await act(async () => { await Promise.resolve(); });
  }

  const rowFor = (name: string) => [...container.querySelectorAll('tbody tr')].find(r => r.textContent?.includes(name))!;

  it("lists every business, marking the one granted Active and the rest No access", async () => {
    await render();
    expect(container.textContent).toContain("Pat Lee's access to clients");
    const granted = rowFor('Green Gadgets');
    const ungranted = rowFor('Blue Widget Co.');
    expect(granted.textContent).toContain('Active');
    expect(granted.textContent).toContain('Accountant');
    expect(ungranted.textContent).toContain('No access');
    expect([...ungranted.querySelectorAll('button')].some(b => b.textContent === 'Edit')).toBe(true);
  });

  it('edits an existing grant via PATCH, not revoke-then-grant', async () => {
    apiPatch.mockResolvedValue({ data: {} });
    await render();
    const granted = rowFor('Green Gadgets');
    const edit = [...granted.querySelectorAll('button')].find(b => b.textContent === 'Edit')!;
    await act(async () => { edit.click(); });
    const save = [...rowFor('Green Gadgets').querySelectorAll('button')].find(b => b.textContent === 'Save')!;
    await act(async () => { save.click(); await Promise.resolve(); });
    expect(apiPatch).toHaveBeenCalledWith('/me/firm/users/pat/business-access/biz-1', { role_override: 'accountant', custom_role_id: null });
  });

  it('grants access to a business with no existing grant via POST', async () => {
    apiPost.mockResolvedValue({ data: {} });
    await render();
    const ungranted = rowFor('Blue Widget Co.');
    const grant = [...ungranted.querySelectorAll('button')].find(b => b.textContent === 'Edit')!;
    await act(async () => { grant.click(); });
    const save = [...rowFor('Blue Widget Co.').querySelectorAll('button')].find(b => b.textContent === 'Save')!;
    await act(async () => { save.click(); await Promise.resolve(); });
    expect(apiPost).toHaveBeenCalledWith('/me/firm/users/pat/business-access', { business_id: 'biz-2', role_override: null, custom_role_id: null });
  });

  it('revokes an existing grant from the row menu, with a confirm', async () => {
    apiDelete.mockResolvedValue({ data: {} });
    await render();
    const granted = rowFor('Green Gadgets');
    const revoke = [...granted.querySelectorAll('[role="menuitem"]')].find(i => i.textContent === 'Revoke access')!;
    await act(async () => { revoke.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); });
    expect(window.confirm).toHaveBeenCalled();
    expect(apiDelete).toHaveBeenCalledWith('/me/firm/users/pat/business-access/biz-1');
  });

  it('disables Revoke access for a business with no grant', async () => {
    await render();
    const ungranted = rowFor('Blue Widget Co.');
    const revoke = [...ungranted.querySelectorAll('[role="menuitem"]')].find(i => i.textContent === 'Revoke access')!;
    expect(revoke.getAttribute('aria-disabled')).toBe('true');
  });

  it('bulk-revokes every checked, granted row at once', async () => {
    apiDelete.mockResolvedValue({ data: {} });
    await render();
    const headerCheckbox = container.querySelector('thead input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { headerCheckbox.click(); });
    expect(container.textContent).toContain('2 selected');

    const bulkRevoke = [...container.querySelectorAll('button')].find(b => b.textContent === 'Revoke access')!;
    await act(async () => { bulkRevoke.click(); await Promise.resolve(); });
    // Only the one actual grant among the two checked rows is revoked.
    expect(apiDelete).toHaveBeenCalledTimes(1);
    expect(apiDelete).toHaveBeenCalledWith('/me/firm/users/pat/business-access/biz-1');
  });

  it('shows a plain message for a firm admin instead of a grant/revoke table', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/me/firm/users') return Promise.resolve({ data: { users: [{ ...pat, role: 'firm_admin', business_access: [] }] } });
      if (url === '/me') return Promise.resolve({ data: { businesses: [{ id: 'biz-1', name: 'Green Gadgets' }] } });
      if (url === '/me/firm/roles') return Promise.resolve({ data: { roles: [] } });
      return Promise.resolve({ data: {} });
    });
    await render();
    expect(container.textContent).toContain('access to every business automatically');
    expect(container.querySelector('tbody')).toBeNull();
  });

  it('bulk-assigns a role to every selected client in one pass', async () => {
    apiPost.mockResolvedValue({ data: {} });
    apiPatch.mockResolvedValue({ data: {} });
    await render();

    const granted = rowFor('Green Gadgets');
    const ungranted = rowFor('Blue Widget Co.');
    await act(async () => {
      (granted.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
      (ungranted.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    });
    expect(container.textContent).toContain('2 selected');

    const assign = [...container.querySelectorAll('button')].find(b => b.textContent === 'Assign to selected')!;
    await act(async () => { assign.click(); await Promise.resolve(); });
    // The already-granted one is PATCHed, the ungranted one is POSTed — never a revoke first.
    expect(apiPatch).toHaveBeenCalledWith('/me/firm/users/pat/business-access/biz-1', { role_override: null, custom_role_id: null });
    expect(apiPost).toHaveBeenCalledWith('/me/firm/users/pat/business-access', { business_id: 'biz-2', role_override: null, custom_role_id: null });
  });

  it('navigates to the client and sets it active from "View client details"', async () => {
    await render();
    const granted = rowFor('Green Gadgets');
    const view = [...granted.querySelectorAll('[role="menuitem"]')].find(i => i.textContent === 'View client details')!;
    await act(async () => { view.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(setActiveBusiness).toHaveBeenCalledWith('biz-1');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('shows "User not found" for an id not in the list', async () => {
    await render('nope');
    expect(container.textContent).toContain('User not found');
  });
});
