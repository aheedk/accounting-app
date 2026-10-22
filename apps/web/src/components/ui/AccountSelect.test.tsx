// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccountSelect } from './AccountSelect';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('AccountSelect', () => {
  // Faizan, 10-21 (item 85): long names were cut off with "…". They wrap now.
  it('shows the whole account name, in the box and in the list', () => {
    const name = 'Operating Bank Account at First National Bank';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <AccountSelect accounts={[{ id: 'a1', code: '1010', name, account_type: 'asset', detail_type: 'Checking' }]} value="a1" onChange={vi.fn()} />,
    ));

    const trigger = host.querySelector('button') as HTMLButtonElement;
    expect(trigger.title).toBe(`1010 ${name}`);
    expect(trigger.textContent).toContain(name);
    expect(trigger.querySelector('.truncate')).toBeNull();
    act(() => trigger.click());
    const option = document.querySelector('[role="option"]') as HTMLElement;
    expect(option.textContent).toContain(name);
    expect(option.querySelector('.truncate')).toBeNull();
    // The QuickBooks account type, when the account has a detail type.
    expect(option.textContent).toContain('Bank');
  });
});
