import { describe, expect, it } from 'vitest';
import { expensePaymentAccounts } from './bankAccountOptions';

const accounts = [
  { id: 'chk', account_type: 'asset', detail_type: 'Checking' },
  { id: 'sav', account_type: 'asset', detail_type: 'Savings' },
  { id: 'equip', account_type: 'asset', detail_type: 'Machinery & Equipment' },
  { id: 'amex', account_type: 'liability', detail_type: 'Credit Card' },
  { id: 'loan', account_type: 'liability', detail_type: 'Loan Payable' },
  { id: 'rent', account_type: 'expense', detail_type: null },
];

describe('expensePaymentAccounts', () => {
  it('lists the bank accounts and the credit cards, nothing else', () => {
    expect(expensePaymentAccounts(accounts, new Set(), '').map(a => a.id)).toEqual(['chk', 'sav', 'amex']);
  });

  it('counts an account set up under Banking as a bank', () => {
    expect(expensePaymentAccounts(accounts, new Set(['equip']), '').map(a => a.id)).toEqual(['chk', 'sav', 'equip', 'amex']);
  });

  it('keeps the account already on the expense listed', () => {
    expect(expensePaymentAccounts(accounts, new Set(), 'loan').map(a => a.id)).toEqual(['chk', 'sav', 'amex', 'loan']);
  });
});
