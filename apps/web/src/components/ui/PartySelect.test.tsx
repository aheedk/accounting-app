// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PartySelect, type Party } from './PartySelect';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const parties: Party[] = [
  { id: 'v1', type: 'vendor', name: 'Acme Supply' },
  { id: 'c1', type: 'customer', name: 'Blue Widget' },
];

function render(onAddNew: (kind: Party['type'], typed: string) => void, onPick = vi.fn()) {
  function Harness() {
    const [text, setText] = useState('');
    return <PartySelect parties={parties} value="" text={text} onPick={onPick} onTextChange={setText} onAddNew={onAddNew} />;
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Harness />));
  return host.querySelector('input')!;
}

function type(input: HTMLInputElement, value: string) {
  act(() => { input.focus(); });
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function key(input: HTMLInputElement, k: string) {
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
}

describe('PartySelect add new', () => {
  it('names what was typed in the add rows, and adds it as the kind clicked', () => {
    const onAddNew = vi.fn();
    const input = render(onAddNew);
    type(input, 'Zebra Supplies');

    const rows = [...document.querySelectorAll('button')].map(b => b.textContent);
    expect(rows).toEqual(['Add “Zebra Supplies” as a vendor', 'Add “Zebra Supplies” as a customer']);

    const asCustomer = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('customer'))!;
    act(() => asCustomer.click());
    expect(onAddNew).toHaveBeenCalledWith('customer', 'Zebra Supplies');
  });

  it('opens Add vendor on Enter when nothing matches, and the arrow keys reach Add customer', () => {
    const onAddNew = vi.fn();
    const input = render(onAddNew);
    type(input, 'Zebra');
    key(input, 'Enter');
    expect(onAddNew).toHaveBeenLastCalledWith('vendor', 'Zebra');

    type(input, 'Zebr');
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(onAddNew).toHaveBeenLastCalledWith('customer', 'Zebr');
  });

  it('still picks a matching name on Enter', () => {
    const onAddNew = vi.fn();
    const onPick = vi.fn();
    const input = render(onAddNew, onPick);
    type(input, 'acme');
    key(input, 'Enter');
    expect(onPick).toHaveBeenCalledWith(parties[0]);
    expect(onAddNew).not.toHaveBeenCalled();
  });
});
