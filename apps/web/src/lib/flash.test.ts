// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flashMessage } from './flash';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('flashMessage', () => {
  it('shows the text, then removes it', () => {
    vi.useFakeTimers();
    flashMessage('Link copied');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Link copied');
    vi.advanceTimersByTime(2500);
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it('replaces a message that is still showing', () => {
    vi.useFakeTimers();
    flashMessage('First');
    flashMessage('Second');
    const shown = document.querySelectorAll('[role="status"]');
    expect(shown).toHaveLength(1);
    expect(shown[0]?.textContent).toBe('Second');
  });
});
