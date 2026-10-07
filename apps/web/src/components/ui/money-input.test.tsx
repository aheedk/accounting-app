// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MoneyInput } from './money-input';
import { cleanMoneyInput, fmtMoneyInput, settleMoneyInput } from '@/lib/money';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('money input helpers', () => {
  it('settles a typed amount to two decimals', () => {
    expect(settleMoneyInput('9')).toBe('9.00');
    expect(settleMoneyInput('9.5')).toBe('9.50');
    expect(settleMoneyInput('9,000')).toBe('9000.00');
    expect(settleMoneyInput('9000.0000')).toBe('9000.00');
    expect(settleMoneyInput('.5')).toBe('0.50');
  });

  it('keeps precision that was entered, up to four places', () => {
    expect(settleMoneyInput('1.125')).toBe('1.125');
    expect(settleMoneyInput('1.12346')).toBe('1.1235');
  });

  it('settles blank or meaningless text to blank', () => {
    expect(settleMoneyInput('')).toBe('');
    expect(settleMoneyInput('.')).toBe('');
    expect(settleMoneyInput('-')).toBe('');
  });

  it('shows amounts with commas and two decimals', () => {
    expect(fmtMoneyInput('9000')).toBe('9,000.00');
    expect(fmtMoneyInput('1234567.5')).toBe('1,234,567.50');
    expect(fmtMoneyInput('-9000')).toBe('-9,000.00');
    expect(fmtMoneyInput('999')).toBe('999.00');
    expect(fmtMoneyInput('')).toBe('');
  });

  it('drops everything that is not part of an amount', () => {
    expect(cleanMoneyInput('$9,000.00')).toBe('9000.00');
    expect(cleanMoneyInput('1.2.3')).toBe('1.23');
    expect(cleanMoneyInput('-50')).toBe('50');
    expect(cleanMoneyInput('-50', true)).toBe('-50');
    expect(cleanMoneyInput('abc')).toBe('');
  });
});

describe('MoneyInput', () => {
  let seen: string[] = [];

  function Harness({ initial }: { initial: string }) {
    const [value, setValue] = useState(initial);
    return (
      <MoneyInput
        value={value}
        onChange={e => { seen.push(e.target.value); setValue(e.target.value); }}
      />
    );
  }

  function mount(initial: string): HTMLInputElement {
    seen = [];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<Harness initial={initial} />));
    return host.querySelector('input')!;
  }

  function type(input: HTMLInputElement, text: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('shows a loaded amount with commas and two decimals', () => {
    expect(mount('9000.0000').value).toBe('9,000.00');
  });

  it('turns a typed 9 into 9.00 on leaving the box, and hands the form a plain number', () => {
    const input = mount('');
    act(() => input.focus());
    type(input, '9');
    expect(input.value).toBe('9');
    act(() => input.blur());
    expect(input.value).toBe('9.00');
    expect(seen).toEqual(['9', '9.00']);
  });

  it('shows the plain number while typing and commas once left', () => {
    const input = mount('9000');
    act(() => input.focus());
    expect(input.value).toBe('9000.00');
    type(input, '12500');
    act(() => input.blur());
    expect(input.value).toBe('12,500.00');
    expect(seen.at(-1)).toBe('12500.00');
  });

  it('changes nothing when an amount is only tabbed through', () => {
    const input = mount('9000.0000');
    act(() => input.focus());
    act(() => input.blur());
    expect(seen).toEqual([]);
    expect(input.value).toBe('9,000.00');
  });

  it('settles on Enter, which submits a form without a blur', () => {
    const input = mount('');
    act(() => input.focus());
    type(input, '45');
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(seen.at(-1)).toBe('45.00');
  });
});
