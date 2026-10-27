// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ChatPanelHost } from '@/components/chat/ChatPanelHost';

const BUSINESSES = [
  { id: 'b1', name: 'Blue Widget Co.', role_override: null },
  { id: 'b2', name: 'Green Gadgets Inc.', role_override: null },
];
const SIGNED_IN = { user: { id: 'u1', full_name: 'Aheed K', role: 'firm_admin' }, businesses: BUSINESSES, logout: vi.fn() };
const LOADING = { user: null, businesses: [], logout: vi.fn() };
let auth: typeof SIGNED_IN | typeof LOADING = LOADING;

vi.mock('@/auth/useAuth', () => ({ useAuth: () => auth }));
// The frame around the page; their own tests cover what is in them.
vi.mock('./Sidebar', () => ({ Sidebar: () => <nav>sidebar</nav> }));
vi.mock('./MobileNav', () => ({ MobileNav: () => null }));
vi.mock('./TopBar', () => ({ TopBar: () => <header>top bar</header> }));
vi.mock('@/components/PdfPreviewHost', () => ({ PdfPreviewHost: () => null }));

// As App.tsx has it: the chat button at the root, beside the routes, and the
// shell only once sign-in has loaded (ProtectedRoute).
function App() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <ChatPanelHost />
      <Routes>
        <Route element={auth.user ? <AppShell /> : <p>loading</p>}>
          <Route path="/" element={<p>Green Gadgets dashboard</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('AppShell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    // jsdom has no matchMedia; the shell only listens for the desktop breakpoint.
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    auth = LOADING;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // Faizan, 10-26, one tab open: any client but the first showed "What
  // happened to this page?" on every load, naming the first client.
  it('opens on the client last open, with no other tab, once sign-in has loaded', () => {
    localStorage.setItem('acct_active_business', 'b2');
    act(() => root.render(<App />));

    auth = SIGNED_IN;
    act(() => root.render(<App />));

    expect(container.textContent).toContain('Green Gadgets dashboard');
    expect(container.textContent).not.toContain('What happened to this page?');
    expect(localStorage.getItem('acct_active_business')).toBe('b2');
  });

  it('is replaced when another tab switches company', () => {
    localStorage.setItem('acct_active_business', 'b2');
    auth = SIGNED_IN;
    act(() => root.render(<App />));

    act(() => {
      localStorage.setItem('acct_active_business', 'b1');
      window.dispatchEvent(new StorageEvent('storage', { key: 'acct_active_business', newValue: 'b1' }));
    });

    expect(container.textContent).toContain('Another tab switched to Blue Widget Co.');
  });
});
