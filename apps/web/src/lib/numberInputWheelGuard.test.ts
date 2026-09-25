// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installNumberInputWheelGuard } from './numberInputWheelGuard';

describe('installNumberInputWheelGuard', () => {
  let uninstall: () => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    uninstall = installNumberInputWheelGuard();
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  function makeInput(type: string) {
    const input = document.createElement('input');
    input.type = type;
    input.value = '18450.00';
    document.body.appendChild(input);
    return input;
  }

  function wheelOver(element: Element) {
    element.dispatchEvent(new Event('wheel', { bubbles: true }));
  }

  it('blurs a focused number input so the wheel cannot change the amount', () => {
    const input = makeInput('number');
    input.focus();
    expect(document.activeElement).toBe(input);

    wheelOver(input);

    expect(document.activeElement).not.toBe(input);
    // The value itself is never touched by the guard.
    expect(input.value).toBe('18450.00');
  });

  it('leaves an unfocused number input alone', () => {
    const input = makeInput('number');
    const other = makeInput('text');
    other.focus();

    wheelOver(input);

    expect(document.activeElement).toBe(other);
  });

  it('does not interfere with other input types', () => {
    const input = makeInput('text');
    input.focus();

    wheelOver(input);

    expect(document.activeElement).toBe(input);
  });

  it('ignores wheel events that are not over an input', () => {
    const input = makeInput('number');
    input.focus();
    const div = document.createElement('div');
    document.body.appendChild(div);

    wheelOver(div);

    // Scrolling elsewhere must not steal focus from the field being edited.
    expect(document.activeElement).toBe(input);
  });

  it('stops acting once uninstalled', () => {
    const input = makeInput('number');
    input.focus();
    uninstall();

    wheelOver(input);

    expect(document.activeElement).toBe(input);
  });
});
