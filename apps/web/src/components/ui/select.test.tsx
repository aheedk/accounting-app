// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppSelect } from './select';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('AppSelect', () => {
  it('uses the text of an <option> that has no value, like a native select', () => {
    const onChange = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <AppSelect value="cash" onChange={onChange}>
        <option>cash</option>
        <option>check</option>
      </AppSelect>,
    ));

    act(() => (host!.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement).click());
    const check = [...document.querySelectorAll('[role="option"]')].find(o => o.textContent?.includes('check')) as HTMLElement;
    act(() => check.click());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0]![0] as { target: { value: string } }).target.value).toBe('check');
  });
});
