import { describe, it, expect } from 'vitest';
import { D, toMoneyString, parseMoney, addMoney, subMoney, mulMoney, roundMoney } from './decimal.js';

describe('decimal helpers', () => {
  it('toMoneyString always returns 4 decimals', () => {
    expect(toMoneyString(D(5))).toBe('5.0000');
    expect(toMoneyString(D('3.1'))).toBe('3.1000');
  });

  it('addMoney sums without float drift', () => {
    expect(toMoneyString(addMoney('0.1', '0.2'))).toBe('0.3000');
  });

  it('subMoney subtracts', () => {
    expect(toMoneyString(subMoney('10.00', '3.3333'))).toBe('6.6667');
  });

  it('mulMoney multiplies', () => {
    expect(toMoneyString(mulMoney('100.00', '0.0875'))).toBe('8.7500');
  });

  it('roundMoney rounds half-even to 4dp', () => {
    expect(toMoneyString(roundMoney('1.12345'))).toBe('1.1234');
    expect(toMoneyString(roundMoney('1.12355'))).toBe('1.1236');
  });

  it('parseMoney throws on non-numeric', () => {
    expect(() => parseMoney('abc')).toThrow();
  });
});
