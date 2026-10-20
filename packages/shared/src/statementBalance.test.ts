import { describe, expect, it } from 'vitest';
import { parseStatementAmount, statementBalanceGap } from './statementBalance.js';

describe('parseStatementAmount', () => {
  it('reads printed and typed balances', () => {
    expect(parseStatementAmount('$12,345.6')).toBe('12345.60');
    expect(parseStatementAmount('(250.00)')).toBe('-250.00');
    expect(parseStatementAmount('250.00-')).toBe('-250.00');
    expect(parseStatementAmount('-0')).toBe('0.00');
    expect(parseStatementAmount(15432.1)).toBe('15432.10');
    expect(parseStatementAmount('15432.1000')).toBe('15432.10');
  });

  it('gives null for anything that is not an amount', () => {
    expect(parseStatementAmount('')).toBeNull();
    expect(parseStatementAmount('n/a')).toBeNull();
    expect(parseStatementAmount('12.3.4')).toBeNull();
    expect(parseStatementAmount(undefined)).toBeNull();
    expect(parseStatementAmount(Number.NaN)).toBeNull();
  });
});

describe('statementBalanceGap', () => {
  const bankLines = [
    { amount: '1000.00', type: 'deposit' },
    { amount: '250.00', type: 'check' },
    { amount: '49.99', type: 'expense' },
  ];

  it('is zero when a bank statement\'s lines carry the beginning balance to the ending one', () => {
    expect(statementBalanceGap('bank', '5000.00', '5700.01', bankLines)).toBe('0.00');
  });

  it('shows what is missing when a line was not read', () => {
    // A 120.00 payment was left out: the statement ends 120.00 lower than the lines reach.
    expect(statementBalanceGap('bank', '5000.00', '5580.01', bankLines)).toBe('-120.00');
  });

  it('counts a card the other way: charges raise what is owed, payments and refunds lower it', () => {
    const cardLines = [
      { amount: '89.99', type: 'expense' },
      { amount: '20.00', type: 'deposit' },
      { amount: '500.00', type: 'deposit' },
    ];
    expect(statementBalanceGap('credit_card', '1200.00', '769.99', cardLines)).toBe('0.00');
  });

  it('is null without both balances', () => {
    expect(statementBalanceGap('bank', null, '5700.01', bankLines)).toBeNull();
    expect(statementBalanceGap('bank', '5000.00', '', bankLines)).toBeNull();
  });
});
