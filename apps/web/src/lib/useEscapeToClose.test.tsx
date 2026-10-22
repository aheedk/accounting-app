// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEscapeToClose } from './useCloseForm';

function Screen({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);
  return <input aria-label="Memo" />;
}

describe('useEscapeToClose', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();

  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Screen onClose={onClose} />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
    onClose.mockReset();
  });

  const press = (target: EventTarget = container.querySelector('input')!) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  it('closes the screen on Escape', () => {
    press();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the screen open while Escape is closing a list', () => {
    const list = document.createElement('ul');
    list.setAttribute('role', 'listbox');
    document.body.appendChild(list);
    // The list closes itself on the key without marking it handled, as some do.
    list.addEventListener('keydown', () => list.remove());
    press(list);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves the screen open when a picker handled the key', () => {
    const input = container.querySelector('input')!;
    input.addEventListener('keydown', e => e.preventDefault());
    press(input);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is not held back by a sidebar section that stays expanded', () => {
    const section = document.createElement('button');
    section.setAttribute('aria-expanded', 'true');
    section.setAttribute('data-disclosure', '');
    document.body.appendChild(section);
    press();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
