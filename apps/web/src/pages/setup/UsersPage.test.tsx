// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import UsersPage from './UsersPage';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', role: 'firm_admin' }, businesses: [] }),
}));

vi.mock('@/lib/apiClient', () => ({
  api: { get: apiGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const row = (id: string, email: string, role: string) => ({
  id, email, full_name: email, role, custom_role: null, last_login_at: null,
  business_access: [], payroll_access: true, deactivated_at: null, locked: false, two_step_enabled: false,
});

describe('UsersPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    apiGet.mockImplementation((url: string) => {
      if (url === '/me/firm/users') {
        return Promise.resolve({ data: { users: [row('me', 'me@firm.test', 'firm_admin'), row('other', 'other@firm.test', 'staff')] } });
      }
      if (url === '/me/firm/roles') return Promise.resolve({ data: { roles: [] } });
      if (url === '/me/firm/security') return Promise.resolve({ data: { require_two_step: false } });
      return Promise.resolve({ data: { businesses: [] } });
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  // Asif read the locked menu on their own row as "Firm Admin is greyed out" and
  // could not tell how to make logins (2026-11-09).
  it('shows your own role as words with the reason, not a greyed-out menu', async () => {
    await act(async () => root.render(<MemoryRouter><UsersPage /></MemoryRouter>));
    await act(async () => { await Promise.resolve(); });

    const rows = [...container.querySelectorAll('tbody tr')];
    const mine = rows.find(r => r.textContent?.includes('me@firm.test'));
    const theirs = rows.find(r => r.textContent?.includes('other@firm.test'));
    expect(mine?.querySelector('button[disabled]')).toBeNull();
    expect(mine?.textContent).toContain('Firm admin');
    expect(mine?.textContent).toContain('Another firm admin can change your role');
    expect(theirs?.querySelector('button:not([disabled])')).not.toBeNull();
  });
});
