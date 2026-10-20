import { describe, it, expect } from 'vitest';
import {
  businessDaysBetween, matchStatementLines, type MatchCandidateItem, type MatchStatementLine,
} from '../../src/services/banking/reconciliationAutoMatch.js';

function item(key: string, date: string, amount: string, overrides: Partial<MatchCandidateItem> = {}): MatchCandidateItem {
  return { key, transaction_date: date, amount, name: null, description: null, already_cleared: false, ...overrides };
}
function line(date: string, amount: string, description: string, overrides: Partial<MatchStatementLine> = {}): MatchStatementLine {
  return { date, amount, description, isInflow: false, ...overrides };
}

describe('businessDaysBetween', () => {
  it('is 0 for the same date', () => {
    expect(businessDaysBetween('2026-03-06', '2026-03-06')).toBe(0);
  });
  it('skips weekends — Friday to Monday is one business day, not three', () => {
    expect(businessDaysBetween('2026-03-06', '2026-03-09')).toBe(1); // Fri -> Mon
  });
  it('is order-independent', () => {
    expect(businessDaysBetween('2026-03-10', '2026-03-05')).toBe(businessDaysBetween('2026-03-05', '2026-03-10'));
  });
});

describe('matchStatementLines', () => {
  it('matches an exact amount within the date window, deposit to deposit', () => {
    const items = [item('deposit:d1', '2026-03-06', '1535.0000')];
    const lines = [line('2026-03-06', '1535.00', 'DEPOSIT', { isInflow: true })];
    expect(matchStatementLines(items, lines)).toEqual(new Set(['deposit:d1']));
  });

  it('matches a check within 3 business days, not exact-day', () => {
    const items = [item('check:c1', '2026-03-09', '-450.0000')]; // posted 3 business days after
    const lines = [line('2026-03-04', '450.00', 'CHECK 1024')]; // check cleared the bank a few days later
    expect(matchStatementLines(items, lines)).toEqual(new Set(['check:c1']));
  });

  it('refuses a date outside the business-day window', () => {
    const items = [item('check:c1', '2026-03-12', '-450.0000')]; // 6 business days out
    const lines = [line('2026-03-04', '450.00', 'CHECK 1024')];
    expect(matchStatementLines(items, lines).size).toBe(0);
  });

  it('never matches a deposit to a negative statement line, even with the same unsigned amount', () => {
    const items = [item('deposit:d1', '2026-03-06', '450.0000')];
    const lines = [line('2026-03-06', '450.00', 'WITHDRAWAL')]; // isInflow: false -> wants a -450 item
    expect(matchStatementLines(items, lines).size).toBe(0);
  });

  it('skips an item that is already cleared (service charge, interest, bank-feed) instead of claiming it twice', () => {
    const items = [item('service_charge:s1', '2026-03-06', '-25.0000', { already_cleared: true })];
    const lines = [line('2026-03-06', '25.00', 'MONTHLY FEE')];
    expect(matchStatementLines(items, lines).size).toBe(0);
  });

  it('breaks a same-amount, same-date tie using description overlap', () => {
    const items = [
      item('check:c1', '2026-03-06', '-100.0000', { name: 'Regions Bank' }),
      item('check:c2', '2026-03-06', '-100.0000', { name: 'Office Depot' }),
    ];
    const lines = [line('2026-03-06', '100.00', 'REGIONS ONLINE PMT')];
    expect(matchStatementLines(items, lines)).toEqual(new Set(['check:c1']));
  });

  it('leaves a genuine tie unticked rather than guessing', () => {
    const items = [
      item('check:c1', '2026-03-06', '-100.0000'),
      item('check:c2', '2026-03-06', '-100.0000'),
    ];
    const lines = [line('2026-03-06', '100.00', 'CHECK')];
    expect(matchStatementLines(items, lines).size).toBe(0);
  });

  it('never matches the same book transaction to two statement lines', () => {
    const items = [item('deposit:d1', '2026-03-06', '500.0000')];
    const lines = [
      line('2026-03-06', '500.00', 'DEPOSIT', { isInflow: true }),
      line('2026-03-06', '500.00', 'DEPOSIT', { isInflow: true }),
    ];
    const matched = matchStatementLines(items, lines);
    expect(matched.size).toBe(1);
  });

  it('falls back to closest date when description does not break a tie', () => {
    const items = [
      item('check:c1', '2026-03-04', '-100.0000'),
      item('check:c2', '2026-03-06', '-100.0000'),
    ];
    const lines = [line('2026-03-06', '100.00', 'CHECK')];
    expect(matchStatementLines(items, lines)).toEqual(new Set(['check:c2']));
  });
});
