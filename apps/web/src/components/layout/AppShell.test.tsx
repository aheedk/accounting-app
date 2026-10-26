// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';

vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', full_name: 'Aheed K', role: 'firm_admin' },
    businesses: [
      { id: 'b1', name: 'Acme LLC', role_override: null },
      { id: 'b2', name: 'Bayside Inc', role_override: null },
    ],
    logout: vi.fn(),
  }),
}));
// The frame around the page; their own tests cover what is in them.
vi.mock('./Sidebar', () => ({ Sidebar: () => <nav>sidebar</nav> }));
vi.mock('./MobileNav', () => ({ MobileNav: () => null }));
vi.mock('./TopBar', () => ({ TopBar: () => <header>top bar</header> }));
vi.mock('@/components/PdfPreviewHost', () => ({ PdfPreviewHost: () => null }));

describe('AppShell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    sessionStorage.clear();
    // jsdom has no matchMedia; the shell only listens for the desktop breakpoint.
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // Faizan, 10-26: picking a client in one tab shut every other tab.
  it('keeps the page open when another tab switches company', () => {
    localStorage.setItem('acct_active_business', 'b1');
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<p>Acme dashboard</p>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
    });

    act(() => {
      localStorage.setItem('acct_active_business', 'b2');
      window.dispatchEvent(new StorageEvent('storage', { key: 'acct_active_business', newValue: 'b2' }));
    });

    expect(container.textContent).toContain('Acme dashboard');
    expect(container.textContent).not.toContain('What happened to this page?');
    expect(document.title).toContain('Acme LLC');
  });
});
