import { describe, expect, it } from 'vitest';
import { expenseTransactionCreateSchema } from './expenseTransaction.js';

const validExpense = {
  transaction_date: '2026-08-10',
  payee_text: 'Office Supply Store',
  expense_account_id: '11111111-1111-4111-8111-111111111111',
  payment_account_id: '22222222-2222-4222-8222-222222222222',
  payment_method: 'card',
  amount: '42.50',
};

describe('expenseTransactionCreateSchema', () => {
  it('accepts a supported payment method', () => {
    expect(expenseTransactionCreateSchema.parse(validExpense).payment_method).toBe('card');
  });

  it('requires a supported payment method', () => {
    const { payment_method: _paymentMethod, ...withoutPaymentMethod } = validExpense;
    expect(expenseTransactionCreateSchema.safeParse(withoutPaymentMethod).success).toBe(false);
    expect(expenseTransactionCreateSchema.safeParse({ ...validExpense, payment_method: 'crypto' }).success).toBe(false);
  });
});
