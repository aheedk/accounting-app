import { describe, expect, it } from 'vitest';
import { RateLimit } from '../../src/lib/rateLimit.js';

describe('RateLimit', () => {
  it('lets the limit through in the window, then refuses until it has passed', () => {
    const limit = new RateLimit(3, 60 * 60_000);
    const t0 = 1_000_000;
    expect([limit.take('a', t0), limit.take('a', t0), limit.take('a', t0)]).toEqual([null, null, null]);
    expect(limit.take('a', t0 + 10 * 60_000)).toBe(50);
    // Another key has its own count.
    expect(limit.take('b', t0)).toBeNull();
    expect(limit.take('a', t0 + 60 * 60_000)).toBeNull();
  });
});
