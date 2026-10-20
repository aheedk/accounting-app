import { toMoneyString } from '@accounting/shared';

// Pure matching logic for item 71 (2026-10-16 follow-ups): given a
// reconciliation's candidate ledger items and an uploaded bank statement's
// own lines, decide which items a statement line clearly accounts for. No DB
// access here on purpose — this is unit-testable on its own; the service that
// resolves which statement belongs to which account, and persists the result,
// lives in bankReconciliationWorksheetService.ts.

export type MatchCandidateItem = {
  key: string; // `${transaction_type}:${transaction_id}`, same shape the worksheet already uses
  transaction_date: string; // ISO
  amount: string; // signed, as WorksheetItem already carries it: deposits +, payments -
  name: string | null;
  description: string | null;
  /** Service-charge/interest/bank-feed-matched rows are already ticked before
   * this runs — skip them so a statement line never "claims" a row that was
   * already accounted for a different way. */
  already_cleared: boolean;
};

export type MatchStatementLine = {
  date: string; // ISO
  amount: string; // unsigned, as extracted off the statement
  description: string;
  payee_name?: string | null;
  isInflow: boolean;
};

function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** Business days strictly between two ISO dates (order-independent), not
 * counting either endpoint's own weekend days. 0 when the dates are equal. */
export function businessDaysBetween(aIso: string, bIso: string): number {
  let a = toUtcDate(aIso);
  let b = toUtcDate(bIso);
  if (a > b) { const t = a; a = b; b = t; }
  let count = 0;
  const cur = new Date(a);
  while (cur < b) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
}

/** How many words a statement line's description/payee share with a
 * candidate's name/description — a crude but effective tiebreaker: even one
 * shared word like "REGIONS" should beat a candidate with none. */
function descriptionScore(line: MatchStatementLine, item: MatchCandidateItem): number {
  const lineTokens = new Set([...tokenize(line.description), ...tokenize(line.payee_name ?? '')]);
  const itemTokens = new Set([...tokenize(item.name ?? ''), ...tokenize(item.description ?? '')]);
  let score = 0;
  for (const t of lineTokens) if (itemTokens.has(t)) score++;
  return score;
}

const MAX_DATE_WINDOW_BUSINESS_DAYS = 3;

/**
 * Returns the set of candidate items' keys that a statement line clearly
 * accounts for. Exact amount (sign-normalized, so a positive statement line
 * only ever considers a deposit-shaped item and a negative one only a
 * payment-shaped item) + a date within 3 business days is the baseline; where
 * more than one candidate ties on that, description word-overlap breaks the
 * tie, then closest date. A tie that survives both is left unticked on
 * purpose — matching the wrong one silently is worse than leaving it manual.
 * Each item and each statement line is used at most once.
 */
export function matchStatementLines(items: MatchCandidateItem[], lines: MatchStatementLine[]): Set<string> {
  const claimed = new Set<string>();
  const usedItemKeys = new Set<string>();
  const available = items.filter(i => !i.already_cleared);

  for (const line of lines) {
    const signedAmount = toMoneyString(line.isInflow ? line.amount : `-${line.amount}`);
    const candidates = available.filter(i =>
      !usedItemKeys.has(i.key)
      && toMoneyString(i.amount) === signedAmount
      && businessDaysBetween(i.transaction_date, line.date) <= MAX_DATE_WINDOW_BUSINESS_DAYS,
    );
    if (candidates.length === 0) continue;

    let winners = candidates;
    if (winners.length > 1) {
      const scored = winners.map(item => ({ item, score: descriptionScore(line, item) }));
      const maxScore = Math.max(...scored.map(s => s.score));
      winners = scored.filter(s => s.score === maxScore).map(s => s.item);
    }
    if (winners.length > 1) {
      const dated = winners.map(item => ({ item, dist: businessDaysBetween(item.transaction_date, line.date) }));
      const minDist = Math.min(...dated.map(d => d.dist));
      winners = dated.filter(d => d.dist === minDist).map(d => d.item);
    }

    if (winners.length === 1) {
      usedItemKeys.add(winners[0]!.key);
      claimed.add(winners[0]!.key);
    }
    // Still tied after both tiebreakers: genuinely ambiguous, leave unticked.
  }

  return claimed;
}
