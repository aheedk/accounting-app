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
  it('shows the whole account name on hover when it is cut off', () => {
    const name = 'Operating Bank Account at First National Bank';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <AccountSelect accounts={[{ id: 'a1', code: '1010', name, account_type: 'asset' }]} value="a1" onChange={vi.fn()} />,
    ));

    const trigger = host.querySelector('button') as HTMLButtonElement;
    expect(trigger.title).toBe(`1010 ${name}`);
    act(() => trigger.click());
    expect(document.querySelector(`[role="option"] [title="${name}"]`)).not.toBeNull();
  });
});
