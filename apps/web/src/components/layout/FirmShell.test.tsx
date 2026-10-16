// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FirmShell } from './FirmShell';
import { getExportCompany, setExportCompany } from '@/lib/reportExport';

let authRole = 'firm_admin';

vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', full_name: 'Aheed K', role: authRole }, businesses: [], logout: vi.fn() }),
}));
// The sidebar's logo is all FirmShell borrows from it.
vi.mock('./Sidebar', () => ({ SidebarBrand: () => <a href="/firm">Accounting</a> }));

describe('FirmShell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    authRole = 'firm_admin';
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render() {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/firm']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/firm" element={<FirmShell />}>
              <Route index element={<p>client list</p>} />
            </Route>
            <Route path="/" element={<p>client dashboard</p>} />
          </Routes>
        </MemoryRouter>,
      );
    });
  }

  it('shows the firm with no client selected, and prints under no client name', async () => {
    setExportCompany('Blue Widget Co.');
    await render();
    expect(container.textContent).toContain('All clients');
    expect(container.textContent).toContain('no client selected');
    expect(container.textContent).toContain('client list');
    expect(container.textContent).not.toContain('Blue Widget Co.');
    expect(getExportCompany()).toBe('');
    expect(document.title).toBe('All clients - Accounting App');
  });

  it('sends anyone but a firm admin to the dashboard of the company that is open', async () => {
    authRole = 'accountant';
    await render();
    expect(container.textContent).toBe('client dashboard');
  });
});
