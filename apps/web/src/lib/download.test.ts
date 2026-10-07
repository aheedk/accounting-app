import { describe, expect, it } from 'vitest';
import { amountInWords } from './download';

describe('amountInWords', () => {
  it('matches the check-writing convention from the spec', () => {
    expect(amountInWords('690.20')).toBe('Six hundred ninety and 20/100');
  });

  it('handles whole dollars, a single dollar, and zero cents', () => {
    expect(amountInWords('1.00')).toBe('One and 00/100');
    expect(amountInWords('42.00')).toBe('Forty two and 00/100');
    expect(amountInWords('0.00')).toBe('Zero and 00/100');
  });

  it('spells out thousands and preserves a leading zero on cents', () => {
    expect(amountInWords('1500.05')).toBe('One thousand five hundred and 05/100');
  });

  it('rounds sub-cent floating point noise before formatting', () => {
    expect(amountInWords(19.99)).toBe('Nineteen and 99/100');
  });
});
