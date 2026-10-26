// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useActiveBusinessId, useNewTabsStartHere } from './business';

vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({
    businesses: [
      { id: 'b1', name: 'Acme LLC', role_override: null },
      { id: 'b2', name: 'Bayside Inc', role_override: null },
    ],
  }),
}));

const KEY = 'acct_active_business';

function Probe({ label }: { label: string }) {
  const [active, pick] = useActiveBusinessId();
  return (
    <p>
      {label}:{active}
      <button type="button" onClick={() => pick('b2')}>pick {label}</button>
    </p>
  );
}

function NewTabsProbe() {
  useNewTabsStartHere();
  return null;
}

describe('the company open in a tab', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('stays the same when another tab switches company', () => {
    localStorage.setItem(KEY, 'b1');
    act(() => root.render(<Probe label="page" />));

    act(() => {
      localStorage.setItem(KEY, 'b2');
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'b2' }));
    });

    expect(container.textContent).toContain('page:b1');
  });

  it('in a new tab is the one last open in the browser, and stays that one', () => {
    localStorage.setItem(KEY, 'b2');
    act(() => root.render(<Probe label="first" />));
    expect(container.textContent).toContain('first:b2');

    // Another tab comes to the front before this one opens its next page.
    localStorage.setItem(KEY, 'b1');
    act(() => root.render(<><Probe label="first" /><Probe label="later" /></>));
    expect(container.textContent).toContain('later:b2');
  });

  it('comes back after a reload of the tab, whatever another tab has open', () => {
    sessionStorage.setItem(KEY, 'b1');
    localStorage.setItem(KEY, 'b2');
    act(() => root.render(<Probe label="page" />));
    expect(container.textContent).toContain('page:b1');
  });

  it('changes everywhere in the tab when picked, and new tabs start on it', () => {
    localStorage.setItem(KEY, 'b1');
    act(() => root.render(<><Probe label="top" /><Probe label="page" /></>));

    act(() => container.querySelector('button')!.click());

    expect(container.textContent).toContain('top:b2');
    expect(container.textContent).toContain('page:b2');
    expect(sessionStorage.getItem(KEY)).toBe('b2');
    expect(localStorage.getItem(KEY)).toBe('b2');
  });

  it('is the first company when the one remembered is not this login\'s', () => {
    sessionStorage.setItem(KEY, 'gone');
    act(() => root.render(<Probe label="page" />));
    expect(container.textContent).toContain('page:b1');
    expect(sessionStorage.getItem(KEY)).toBe('b1');
  });

  it('is where a new tab starts once this tab is back in front', () => {
    sessionStorage.setItem(KEY, 'b1');
    localStorage.setItem(KEY, 'b2'); // another tab was in front last
    act(() => root.render(<NewTabsProbe />));

    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(localStorage.getItem(KEY)).toBe('b1');
  });
});
