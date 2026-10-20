import { D } from './decimal.js';

// A statement's own balances against its lines (item 72, 10-16 follow-ups).
// Spec: docs/specs/2026-10-04-card-statements-and-check-stubs-design.md, section 4.

/**
 * A balance as printed or typed ("$1,234.56", "(12.00)", "12.00-") to
 * "1234.56". Null when it is not an amount.
 */
export function parseStatementAmount(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? D(value).toFixed(2) : null;
  if (typeof value !== 'string') return null;
  let text = value.replace(/[$,\s]/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  if (text.endsWith('-')) { negative = true; text = text.slice(0, -1); }
  if (text.startsWith('-')) { negative = true; text = text.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const amount = D(text);
  return (negative && !amount.isZero() ? amount.negated() : amount).toFixed(2);
}

/** A statement line as far as the balance goes: `deposit` and `credit` put money into the statement's account. */
export type BalanceLine = { amount: string; type: string };

/**
 * How far the lines miss the statement's ending balance: the ending balance
 * less (the beginning balance plus what the lines moved). "0.00" when they
 * agree; null without both balances. A card's balances are what is owed, so a
 * charge raises it and a payment or refund lowers it.
 */
export function statementBalanceGap(
  kind: 'bank' | 'credit_card',
  beginning: unknown,
  ending: unknown,
  lines: BalanceLine[],
): string | null {
  const begin = parseStatementAmount(beginning);
  const end = parseStatementAmount(ending);
  if (begin === null || end === null) return null;
  let intoAccount = D(0);
  for (const line of lines) {
    const amount = parseStatementAmount(line.amount);
    if (amount === null) continue;
    const size = D(amount).abs();
    intoAccount = line.type === 'deposit' || line.type === 'credit' ? intoAccount.plus(size) : intoAccount.minus(size);
  }
  const expected = kind === 'credit_card' ? D(begin).minus(intoAccount) : D(begin).plus(intoAccount);
  const gap = D(end).minus(expected);
  return gap.isZero() ? '0.00' : gap.toFixed(2);
}
