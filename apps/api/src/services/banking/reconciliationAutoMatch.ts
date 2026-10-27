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
  /** The transaction's own check/reference number, if it has one — compared
   * against a statement line's check_number for the highest-confidence tier. */
  ref_no?: string | null;
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
  checkNumber?: string | null;
};

/** Why a statement line matched the book item it did — the review UI's
 * confidence badge reads this, not a re-derivation of its own. */
export type MatchReason = 'exact_reference' | 'amount_and_date' | 'fuzzy_description';

export type MatchDetail = {
  /** Position in the `lines` array passed in — the review UI's stable id for
   * a statement line, since a statement line isn't its own DB row. */
  lineIndex: number;
  matchedKey: string | null;
  reason: MatchReason | null;
  /** 0–1, null when unmatched. Bucketed by `reason`, not a graded score — see
   * the module comment on why this stays simple. */
  confidence: number | null;
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

function sameRefNo(a: string | null | undefined, b: string | null | undefined): boolean {
  const an = (a ?? '').trim().replace(/^0+/, '').toLowerCase();
  const bn = (b ?? '').trim().replace(/^0+/, '').toLowerCase();
  return an !== '' && an === bn;
}

// 4, not 3: Faizan, 10-25 meeting (item 93).
const MAX_DATE_WINDOW_BUSINESS_DAYS = 4;

/**
 * The real matching pass, run once over every statement line. Exact amount
 * (sign-normalized, so a positive statement line only ever considers a
 * deposit-shaped item and a negative one only a payment-shaped item) + a date
 * within 4 business days is the baseline; where more than one candidate ties
 * on that, description word-overlap breaks the tie, then closest date. A tie
 * that survives both is left unmatched on purpose — matching the wrong one
 * silently is worse than leaving it manual. Each item and each statement line
 * is used at most once.
 *
 * Returns one `MatchDetail` per input line, in order, so a caller can show
 * every statement line — matched or not — not just recover the matched set.
 */
export function matchStatementLinesDetailed(items: MatchCandidateItem[], lines: MatchStatementLine[]): MatchDetail[] {
  const usedItemKeys = new Set<string>();
  const available = items.filter(i => !i.already_cleared);
  const results: MatchDetail[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    const signedAmount = toMoneyString(line.isInflow ? line.amount : `-${line.amount}`);
    const candidates = available.filter(i =>
      !usedItemKeys.has(i.key)
      && toMoneyString(i.amount) === signedAmount
      && businessDaysBetween(i.transaction_date, line.date) <= MAX_DATE_WINDOW_BUSINESS_DAYS,
    );
    if (candidates.length === 0) {
      results.push({ lineIndex, matchedKey: null, reason: null, confidence: null });
      continue;
    }

    let winners = candidates;
    let reason: MatchReason = 'amount_and_date';
    if (winners.length > 1) {
      const scored = winners.map(item => ({ item, score: descriptionScore(line, item) }));
      const maxScore = Math.max(...scored.map(s => s.score));
      winners = scored.filter(s => s.score === maxScore).map(s => s.item);
      if (winners.length < candidates.length && maxScore > 0) reason = 'fuzzy_description';
    }
    if (winners.length > 1) {
      const dated = winners.map(item => ({ item, dist: businessDaysBetween(item.transaction_date, line.date) }));
      const minDist = Math.min(...dated.map(d => d.dist));
      winners = dated.filter(d => d.dist === minDist).map(d => d.item);
    }

    if (winners.length === 1) {
      const winner = winners[0]!;
      usedItemKeys.add(winner.key);
      // A shared check/reference number is the strongest signal there is —
      // worth a higher confidence tier even when amount+date alone already
      // settled it uniquely (the common case: one line, one candidate).
      if (sameRefNo(winner.ref_no, line.checkNumber)) reason = 'exact_reference';
      const dist = businessDaysBetween(winner.transaction_date, line.date);
      const confidence = reason === 'exact_reference'
        ? 0.98
        : reason === 'fuzzy_description'
          ? 0.65 + Math.min(0.1, descriptionScore(line, winner) * 0.05)
          : Math.max(0.8, 0.95 - dist * 0.05);
      results.push({ lineIndex, matchedKey: winner.key, reason, confidence: Math.round(confidence * 100) / 100 });
      continue;
    }
    // Still tied after both tiebreakers: genuinely ambiguous, leave unmatched.
    results.push({ lineIndex, matchedKey: null, reason: null, confidence: null });
  }

  return results;
}

/** The matched book-item keys only — what `startReconciliation` needs to
 * pre-tick the worksheet. A thin view over `matchStatementLinesDetailed`, so
 * the two never drift apart. */
export function matchStatementLines(items: MatchCandidateItem[], lines: MatchStatementLine[]): Set<string> {
  const claimed = new Set<string>();
  for (const detail of matchStatementLinesDetailed(items, lines)) {
    if (detail.matchedKey) claimed.add(detail.matchedKey);
  }
  return claimed;
}
