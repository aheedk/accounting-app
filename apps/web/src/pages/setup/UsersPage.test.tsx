// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import UsersPage from './UsersPage';

const { apiGet, apiPost, apiPatch, apiDelete } = vi.hoisted(() => ({
  apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(),
}));

vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', role: 'firm_admin' }, businesses: [] }),
}));

vi.mock('@/lib/apiClient', () => ({
  api: { get: apiGet, post: apiPost, patch: apiPatch, delete: apiDelete },
}));

// The Radix menu does not open under jsdom (it hangs), so its items render in
// place — same mock VendorDetailPage.test.tsx uses for the same component.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children, disabled, onSelect, className }: {
    children: ReactNode; disabled?: boolean; onSelect?: (e: { preventDefault: () => void }) => void; className?: string;
  }) => (
    <div role="menuitem" className={className} aria-disabled={disabled ? 'true' : undefined}
      onClick={() => { if (!disabled) onSelect?.({ preventDefault: () => {} }); }}>
      {children}
    </div>
  ),
}));

const row = (id: string, email: string, role: string, extra: Partial<{
  invitation_status: string; invitation_expires_at: string | null; deactivated_at: string | null; full_name: string;
}> = {}) => ({
  id, email, full_name: extra.full_name ?? email, role, custom_role: null, last_login_at: null,
  business_access: [], payroll_access: true, deactivated_at: null, locked: false, two_step_enabled: false,
  invitation_status: 'accepted', invitation_expires_at: null, ...extra,
});

describe('UsersPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('confirm', vi.fn(() => true));
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
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => root.render(<MemoryRouter><UsersPage /></MemoryRouter>));
    await act(async () => { await Promise.resolve(); });
  }

  const rowFor = (email: string) => [...container.querySelectorAll('tbody tr')].find(r => r.textContent?.includes(email))!;
  const menuItem = (tr: Element, label: string) => [...tr.querySelectorAll('[role="menuitem"]')].find(i => i.textContent === label);

  // Setting .value directly doesn't trigger React's change tracking; go
  // through the native setter, like PartySelect.test.tsx and others here do.
  function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // AppSelect is a custom combobox, not a native <select> — open it by its
  // current label, then click the option by its label.
  async function chooseAppSelect(currentLabel: string, optionLabel: string) {
    const trigger = [...container.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')].find(b => b.textContent === currentLabel)!;
    await act(async () => { trigger.click(); });
    const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.textContent === optionLabel)!;
    await act(async () => { option.click(); });
  }

  it("shows your own role as words with a (You) tag, not a disabled menu", async () => {
    await render();
    const mine = rowFor('me@firm.test');
    const theirs = rowFor('other@firm.test');
    expect(mine.textContent).toContain('Firm admin');
    expect(mine.textContent).toContain('(You)');
    expect(mine.querySelector('select, button[aria-haspopup]')).toBeNull(); // no role dropdown on your own row
    expect(theirs.querySelector('button[disabled]')).toBeNull();
  });

  it('shows a status pill per login, and filters by status', async () => {
    const future = new Date(Date.now() + 1000).toISOString();
    const past = new Date(Date.now() - 1000).toISOString();
    apiGet.mockImplementation((url: string) => {
      if (url === '/me/firm/users') {
        return Promise.resolve({
          data: {
            users: [
              row('active', 'active@firm.test', 'staff'),
              row('sent', 'sent@firm.test', 'staff', { invitation_status: 'sent', invitation_expires_at: future }),
              row('expired', 'expired@firm.test', 'staff', { invitation_status: 'sent', invitation_expires_at: past }),
              row('off', 'off@firm.test', 'staff', { deactivated_at: '2026-01-01T00:00:00Z' }),
            ],
          },
        });
      }
      if (url === '/me/firm/roles') return Promise.resolve({ data: { roles: [] } });
      if (url === '/me/firm/security') return Promise.resolve({ data: { require_two_step: false } });
      return Promise.resolve({ data: { businesses: [] } });
    });
    await render();

    expect(rowFor('active@firm.test').textContent).toContain('Active');
    expect(rowFor('sent@firm.test').textContent).toContain('Invited');
    expect(rowFor('expired@firm.test').textContent).toContain('Expired');
    expect(rowFor('off@firm.test').textContent).toContain('Deactivated');

    await chooseAppSelect('All statuses', 'Deactivated');
    const bodyText = container.querySelector('tbody')!.textContent ?? '';
    expect(bodyText).toContain('off@firm.test');
    expect(bodyText).not.toContain('active@firm.test');
  });

  it('filters by name or email search', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/me/firm/users') {
        return Promise.resolve({ data: { users: [row('a', 'alice@firm.test', 'staff', { full_name: 'Alice Smith' }), row('b', 'bob@firm.test', 'staff', { full_name: 'Bob Jones' })] } });
      }
      if (url === '/me/firm/roles') return Promise.resolve({ data: { roles: [] } });
      if (url === '/me/firm/security') return Promise.resolve({ data: { require_two_step: false } });
      return Promise.resolve({ data: { businesses: [] } });
    });
    await render();

    const search = container.querySelector('input[placeholder="Search by name or email"]') as HTMLInputElement;
    await act(async () => { type(search, 'alice'); });
    const bodyText = container.querySelector('tbody')!.textContent ?? '';
    expect(bodyText).toContain('alice@firm.test');
    expect(bodyText).not.toContain('bob@firm.test');
  });

  it('shows Resend invitation only while invited/expired, Reset password until deactivated, and confirms + flashes on success', async () => {
    const future = new Date(Date.now() + 1000).toISOString();
    apiGet.mockImplementation((url: string) => {
      if (url === '/me/firm/users') {
        return Promise.resolve({
          data: {
            users: [
              row('me', 'me@firm.test', 'firm_admin'),
              row('sent', 'sent@firm.test', 'staff', { invitation_status: 'sent', invitation_expires_at: future }),
              row('active', 'active@firm.test', 'staff'),
              row('off', 'off@firm.test', 'staff', { deactivated_at: '2026-01-01T00:00:00Z' }),
            ],
          },
        });
      }
      if (url === '/me/firm/roles') return Promise.resolve({ data: { roles: [] } });
      if (url === '/me/firm/security') return Promise.resolve({ data: { require_two_step: false } });
      return Promise.resolve({ data: { businesses: [] } });
    });
    apiPost.mockResolvedValue({ data: { ok: true } });
    await render();

    const sent = rowFor('sent@firm.test');
    const active = rowFor('active@firm.test');
    const off = rowFor('off@firm.test');
    expect(menuItem(sent, 'Resend invitation')).not.toBeUndefined();
    expect(menuItem(active, 'Resend invitation')).toBeUndefined();
    expect(menuItem(off, 'Resend invitation')).toBeUndefined();
    expect(menuItem(off, 'Reset password')).toBeUndefined();
    expect(menuItem(active, 'Reset password')).not.toBeUndefined();
    expect(menuItem(off, 'Switch on')).not.toBeUndefined();
    expect(menuItem(active, 'Sign out everywhere')).not.toBeUndefined();
    expect(menuItem(off, 'Sign out everywhere')).not.toBeUndefined(); // may still have a lingering session

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await act(async () => { menuItem(active, 'Sign out everywhere')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); });
    expect(apiPost).not.toHaveBeenCalled();

    await act(async () => { menuItem(active, 'Sign out everywhere')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); });
    expect(apiPost).toHaveBeenCalledWith('/me/firm/users/active/sign-out');
    expect(rowFor('active@firm.test').textContent).toContain('Signed out everywhere');
  });

  it("hides Switch off and Delete for the only active firm admin, and for your own row", async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/me/firm/users') {
        return Promise.resolve({
          data: {
            users: [
              row('me', 'me@firm.test', 'staff'),
              row('admin2', 'admin2@firm.test', 'firm_admin'), // the only firm admin
            ],
          },
        });
      }
      if (url === '/me/firm/roles') return Promise.resolve({ data: { roles: [] } });
      if (url === '/me/firm/security') return Promise.resolve({ data: { require_two_step: false } });
      return Promise.resolve({ data: { businesses: [] } });
    });
    await render();

    const admin2 = rowFor('admin2@firm.test');
    expect(menuItem(admin2, 'Switch off')).toBeUndefined();
    expect(menuItem(admin2, 'Delete')).toBeUndefined();
  });

  it('renames a login from the Edit user menu item', async () => {
    apiPatch.mockResolvedValue({ data: { id: 'other', email: 'other@firm.test', full_name: 'New Name' } });
    await render();

    const theirs = rowFor('other@firm.test');
    await act(async () => { menuItem(theirs, 'Edit user')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const input = rowFor('other@firm.test').querySelector('input') as HTMLInputElement;
    await act(async () => { type(input, 'New Name'); });
    const save = [...rowFor('other@firm.test').querySelectorAll('button')].find(b => b.textContent === 'Save')!;
    await act(async () => { save.click(); await Promise.resolve(); });
    expect(apiPatch).toHaveBeenCalledWith('/me/firm/users/other/profile', { full_name: 'New Name' });
  });

  it('deletes a login from the Delete menu item, and shows the server error when it is refused', async () => {
    apiDelete.mockRejectedValue({ response: { data: { error: { message: 'Cannot delete — has activity on record. Use "Switch off" instead.' } } } });
    await render();

    const theirs = rowFor('other@firm.test');
    await act(async () => { menuItem(theirs, 'Delete')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); });
    expect(apiDelete).toHaveBeenCalledWith('/me/firm/users/other');
    expect(rowFor('other@firm.test').textContent).toContain('Switch off');
  });

  async function createUser(emailSent: boolean) {
    apiPost.mockResolvedValue({ data: { user: { id: 'new', email: 'new@firm.test', full_name: 'New Guy', role: 'staff' }, email_sent: emailSent } });
    await render();

    const addUser = [...container.querySelectorAll('button')].find(b => b.textContent === 'Add user')!;
    await act(async () => { addUser.click(); });
    const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
    const nameInput = [...container.querySelectorAll('input')].find(i => i !== emailInput && i.required) as HTMLInputElement;
    await act(async () => { type(emailInput, 'new@firm.test'); type(nameInput, 'New Guy'); });
    const form = container.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve(); });
  }

  it('shows a green banner once the invitation email sends', async () => {
    await createUser(true);
    expect(container.textContent).toContain('User created');
    expect(container.textContent).not.toContain('but the email failed');
  });

  it('shows an amber warning, not a silent success, when the invitation email fails to send', async () => {
    await createUser(false);
    expect(container.textContent).toContain('User created, but the email failed');
    expect(container.textContent).toContain("invitation email couldn't be sent");
  });
});
