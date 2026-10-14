import { describe, expect, it } from 'vitest';
import { billOpenAmount } from './vendorBalances';

describe('billOpenAmount', () => {
  it('is what is left on a part-paid bill, not its total', () => {
    expect(billOpenAmount({ total: '250.0000', open_balance: '200.0000' })).toBe(200);
  });

  it('falls back to the total when the bill carries no open amount', () => {
    expect(billOpenAmount({ total: '250.0000' })).toBe(250);
    expect(billOpenAmount({ total: '250.0000', open_balance: null })).toBe(250);
  });
});
