import { describe, expect, it } from 'vitest';
import { billOpenAmount, vendorOpenBalances } from './vendorBalances';

describe('vendorOpenBalances', () => {
  it('takes each vendor\'s balance from the aging total, credits included', () => {
    const balances = vendorOpenBalances([
      { id: 'v1', total: '450.0000' },
      { id: 'v2', total: '-75.0000' },   // a credit with the vendor
    ]);
    expect(balances.get('v1')).toBe(450);
    expect(balances.get('v2')).toBe(-75);
    expect(balances.get('v3')).toBeUndefined();
  });
});

describe('billOpenAmount', () => {
  it('is what is left on a part-paid bill, not its total', () => {
    expect(billOpenAmount({ total: '250.0000', open_balance: '200.0000' })).toBe(200);
  });

  it('falls back to the total when the bill carries no open amount', () => {
    expect(billOpenAmount({ total: '250.0000' })).toBe(250);
    expect(billOpenAmount({ total: '250.0000', open_balance: null })).toBe(250);
  });
});
