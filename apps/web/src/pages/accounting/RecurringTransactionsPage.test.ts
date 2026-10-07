import { describe, expect, it } from 'vitest';
import { templateAmount } from './RecurringTransactionsPage';

// 2026-09-28 audit: every template showed 0.00 in the Amount column.
describe('templateAmount', () => {
  it('adds the debits of a journal entry template', () => {
    expect(templateAmount({ lines: [{ debit: '1200.00', credit: '0' }, { debit: '0', credit: '1200.00' }] })).toBe(1200);
  });

  it('multiplies quantity by price on an invoice or bill template', () => {
    expect(templateAmount({ lines: [{ quantity: '2', unit_price: '150.00' }, { quantity: 1, unit_price: 49.5 }] })).toBe(349.5);
  });

  it('adds the line amounts of a deposit, expense or check template', () => {
    expect(templateAmount({ lines: [{ amount: '800.00' }, { amount: 75 }] })).toBe(875);
  });

  it('is zero for a template with nothing readable in it', () => {
    expect(templateAmount(null)).toBe(0);
    expect(templateAmount({})).toBe(0);
    expect(templateAmount({ lines: 'nope' })).toBe(0);
  });
});
