import { describe, expect, it } from 'vitest';
import { stripForwardedPorts } from '../../src/lib/forwardedFor.js';

describe('X-Forwarded-For without ports', () => {
  it("drops the port Azure adds to the visitor's address", () => {
    expect(stripForwardedPorts('203.0.113.7:51234')).toBe('203.0.113.7');
  });

  it('drops it from every entry, keeping their order', () => {
    expect(stripForwardedPorts('198.51.100.2:4431, 203.0.113.7:51234')).toBe('198.51.100.2, 203.0.113.7');
  });

  it('takes the brackets and port off an IPv6 address', () => {
    expect(stripForwardedPorts('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(stripForwardedPorts('[2001:db8::1]')).toBe('2001:db8::1');
  });

  it('leaves plain addresses alone, IPv6 included', () => {
    expect(stripForwardedPorts('203.0.113.7')).toBe('203.0.113.7');
    expect(stripForwardedPorts('2001:db8::1')).toBe('2001:db8::1');
    expect(stripForwardedPorts('::ffff:203.0.113.7')).toBe('::ffff:203.0.113.7');
  });
});
