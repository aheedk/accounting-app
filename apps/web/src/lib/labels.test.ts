import { describe, expect, it } from 'vitest';
import { fmtQty, humanizeCode } from './labels';

// 2026-09-28 audit: raw codes ("Bill_payment", "Ach", "straight_line") and padded
// quantities ("1.0000") were shown as they are stored.
describe('humanizeCode', () => {
  it('turns a stored code into words', () => {
    expect(humanizeCode('bill_payment')).toBe('Bill payment');
    expect(humanizeCode('straight_line')).toBe('Straight line');
    expect(humanizeCode('firm_admin')).toBe('Firm admin');
    expect(humanizeCode('check')).toBe('Check');
  });

  it('keeps abbreviations as abbreviations', () => {
    expect(humanizeCode('ach')).toBe('ACH');
  });

  it('is blank for nothing', () => {
    expect(humanizeCode(null)).toBe('');
    expect(humanizeCode('')).toBe('');
  });
});

describe('fmtQty', () => {
  it('drops the padding and keeps real decimals', () => {
    expect(fmtQty('1.0000')).toBe('1');
    expect(fmtQty('21.0000')).toBe('21');
    expect(fmtQty('2.5000')).toBe('2.5');
    expect(fmtQty('1250.0000')).toBe('1,250');
    expect(fmtQty(0.125)).toBe('0.125');
  });

  it('passes through what is not a number', () => {
    expect(fmtQty('')).toBe('');
    expect(fmtQty(null)).toBe('');
    expect(fmtQty('n/a')).toBe('n/a');
  });
});
