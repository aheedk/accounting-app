import { describe, it, expect } from 'vitest';
import { isValidPhone, phoneSchema } from './phone.js';

describe('isValidPhone', () => {
  it('accepts a bare 10-digit number', () => {
    expect(isValidPhone('8135551234')).toBe(true);
  });

  it('accepts formatted 10-digit numbers', () => {
    expect(isValidPhone('(813) 555-1234')).toBe(true);
    expect(isValidPhone('813.555.1234')).toBe(true);
    expect(isValidPhone('813-555-1234')).toBe(true);
  });

  it('accepts an 11-digit number with a leading US country code', () => {
    expect(isValidPhone('18135551234')).toBe(true);
  });

  it('rejects a 7-digit number', () => {
    expect(isValidPhone('555-0133')).toBe(false);
  });

  it('rejects too few or too many digits', () => {
    expect(isValidPhone('123')).toBe(false);
    expect(isValidPhone('813555123456')).toBe(false);
  });
});

describe('phoneSchema', () => {
  it('allows null, undefined and empty string (no phone on file)', () => {
    expect(phoneSchema.safeParse(null).success).toBe(true);
    expect(phoneSchema.safeParse(undefined).success).toBe(true);
    expect(phoneSchema.safeParse('').success).toBe(true);
  });

  it('accepts a valid 10-digit number', () => {
    expect(phoneSchema.safeParse('(813) 555-1234').success).toBe(true);
  });

  it('rejects a 7-digit number', () => {
    const r = phoneSchema.safeParse('555-0133');
    expect(r.success).toBe(false);
  });
});
