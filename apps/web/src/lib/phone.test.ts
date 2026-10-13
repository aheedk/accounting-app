import { describe, expect, it } from 'vitest';
import { cleanPhoneInput, formatPhone, settlePhoneInput } from './phone';

describe('formatPhone', () => {
  it('formats a 10-digit number regardless of how it was typed', () => {
    expect(formatPhone('8135551234')).toBe('(813) 555-1234');
    expect(formatPhone('(813) 555-1234')).toBe('(813) 555-1234');
    expect(formatPhone('813.555.1234')).toBe('(813) 555-1234');
    expect(formatPhone('813-555-1234')).toBe('(813) 555-1234');
  });

  it('drops a leading US country code', () => {
    expect(formatPhone('18135551234')).toBe('(813) 555-1234');
    expect(formatPhone('+1 813 555 1234')).toBe('(813) 555-1234');
  });

  it('leaves anything that is not a recognizable 10-digit US number as typed', () => {
    expect(formatPhone('555-0133')).toBe('555-0133');
    expect(formatPhone('813 555 0147 x204')).toBe('813 555 0147 x204');
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
  });

  it('passes through null/empty', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone('')).toBe('');
  });
});

describe('settlePhoneInput', () => {
  it('reformats a complete 10-digit number on blur', () => {
    expect(settlePhoneInput('8135551234')).toBe('(813) 555-1234');
  });

  it('leaves a short or non-US number alone', () => {
    expect(settlePhoneInput('555-0133')).toBe('555-0133');
  });
});

describe('cleanPhoneInput', () => {
  it('keeps digits and the punctuation a phone number can contain while typing', () => {
    expect(cleanPhoneInput('abc813)555-1234x12')).toBe('813)555-1234x12');
  });
});
