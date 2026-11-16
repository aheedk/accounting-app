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

  it('resolves options injected by a wrapping component, like Setup → Users\' RoleOptions', () => {
    // AppSelect walks raw <option>/<optgroup> elements rather than rendering
    // `children` through React, so a reusable component that injects them (as
    // Setup → Users' role dropdowns do) has to be called, not just inspected.
    function InjectedOptions() {
      return (
        <>
          <optgroup label="Built-in roles">
            <option value="builtin:firm_admin">Firm admin</option>
            <option value="builtin:staff">Staff</option>
          </optgroup>
        </>
      );
    }
    const onChange = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <AppSelect value="builtin:staff" onChange={onChange}>
        <InjectedOptions />
      </AppSelect>,
    ));

    expect(host.querySelector('button[aria-haspopup="listbox"]')?.textContent).toBe('Staff');
    act(() => (host!.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement).click());
    const admin = [...document.querySelectorAll('[role="option"]')].find(o => o.textContent?.includes('Firm admin')) as HTMLElement;
    expect(admin).toBeDefined();
    act(() => admin.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0]![0] as { target: { value: string } }).target.value).toBe('builtin:firm_admin');
  });

  it('shows the whole name on hover when it is cut off', () => {
    const long = '1010 — Operating Bank Account at First National Bank';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <AppSelect value="a1" onChange={vi.fn()}>
        <option value="a1">{long}</option>
      </AppSelect>,
    ));

    const trigger = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    expect(trigger.querySelector(`[title="${long}"]`)).not.toBeNull();
    act(() => trigger.click());
    expect(document.querySelector(`[role="option"] [title="${long}"]`)).not.toBeNull();
  });

  // Setup → Users' table wraps its rows in overflow-x-auto for horizontal
  // scrolling, which (per the CSS overflow spec) also clips the y axis — the
  // listbox used to render inside that ancestor and get cut off there.
  it('escapes a clipping ancestor instead of being cut off inside it', () => {
    const clipper = document.createElement('div');
    clipper.style.overflow = 'hidden';
    host = document.createElement('div');
    clipper.appendChild(host);
    document.body.appendChild(clipper);
    root = createRoot(host);
    act(() => root!.render(
      <AppSelect value="a" onChange={vi.fn()}>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </AppSelect>,
    ));

    act(() => (host!.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement).click());
    const listbox = document.querySelector('[role="listbox"]')!;
    expect(clipper.contains(listbox)).toBe(false);
    expect(document.body.contains(listbox)).toBe(true);
    clipper.remove();
  });
});
