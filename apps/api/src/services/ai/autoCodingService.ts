import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import {
  normalizeVendor,
  confidenceBand,
  type CodingLayerId,
  type ConfidenceBand,
  ERR,
} from '@accounting/shared';
import { BusinessRuleError } from '../../lib/errors.js';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';

/** Every auto-coding path is business-scoped; narrow the nullable ctx field once. */
function requireBusiness(ctx: ServiceCtx): string {
  if (!ctx.business_id) {
    throw new BusinessRuleError(ERR.NOT_FOUND, 'No business selected');
  }
  return ctx.business_id;
}

export type SuggestionLine = {
  account_id: string;
  debit: string;
  credit: string;
  memo: string | null;
};

export type Suggestion = {
  confidence: number;
  source_layer: CodingLayerId;
  band: ConfidenceBand;
  lines: SuggestionLine[];
};

export type CodingInput = {
  description: string;
  /** Always positive; `direction` carries the sign. */
  amount: string;
  direction: 'debit' | 'credit';
  bank_account_id: string;
  /**
   * Account name the extraction model proposed for this row, if any. The AI
   * layer resolves this against the client's CoA rather than making a second
   * model call -- the document was already classified in one pass.
   */
  ai_suggested_account?: string | null;
};

/** Upper bound on the history rows scanned per suggestion (layer 4). */
const HISTORY_SCAN_LIMIT = 2000;

type AccountRow = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  detail_type: string | null;
};

/**
 * Deterministic transaction types. These encode accounting treatment, so they
 * are resolved from the description before any vendor default, history, or AI
 * opinion is consulted.
 */
export type DetectedType =
  | 'transfer'
  | 'credit_card_payment'
  | 'loan_payment'
  | 'payroll'
  | null;

const TYPE_PATTERNS: Array<{ type: NonNullable<DetectedType>; pattern: RegExp }> = [
  // Order matters: a "transfer to credit card" is a card payment, not a transfer.
  { type: 'credit_card_payment', pattern: /\b(?:visa|mastercard|amex|american express|discover|chase card|capital one|credit\s?card)\b.*\bpay(?:ment|ed|)?\b|\bpay(?:ment)?\b.*\b(?:visa|mastercard|amex|credit\s?card)\b/i },
  { type: 'payroll', pattern: /\b(?:adp|gusto|paychex|paylocity|trinet|rippling|payroll|wages|direct\s?dep)\b/i },
  { type: 'loan_payment', pattern: /\b(?:loan|mortgage|note\s?payable|principal|sba)\b/i },
  { type: 'transfer', pattern: /\b(?:transfer|xfer|wire (?:to|from)|to savings|from savings|internal)\b/i },
];

export function detectTransactionType(description: string): DetectedType {
  for (const { type, pattern } of TYPE_PATTERNS) {
    if (pattern.test(description)) return type;
  }
  return null;
}

function line(accountId: string, direction: 'debit' | 'credit', amount: string, memo: string | null): SuggestionLine {
  // The offsetting line mirrors the bank side: money leaving the bank (credit
  // to cash) is a debit to the offset account, and vice versa.
  return direction === 'debit'
    ? { account_id: accountId, debit: amount, credit: '0.0000', memo }
    : { account_id: accountId, debit: '0.0000', credit: amount, memo };
}

function build(
  accountId: string,
  input: CodingInput,
  confidence: number,
  layer: CodingLayerId,
  memo: string | null = null,
): Suggestion {
  return {
    confidence,
    source_layer: layer,
    band: confidenceBand(confidence),
    lines: [line(accountId, input.direction, input.amount, memo)],
  };
}

async function activeAccounts(db: Kysely<DB> | Transaction<DB>, businessId: string): Promise<AccountRow[]> {
  return db.selectFrom('chart_of_accounts')
    .select(['id', 'code', 'name', 'account_type', 'detail_type'])
    .where('business_id', '=', businessId)
    .where('is_active', '=', true)
    .where('is_locked', '=', false)
    .execute();
}

/** Match an account by detail type first, then by a name fragment. */
function findAccount(
  accounts: AccountRow[],
  opts: { detailTypes?: string[]; nameLike?: RegExp; accountType?: string },
): AccountRow | undefined {
  if (opts.detailTypes) {
    const byDetail = accounts.find(a => a.detail_type && opts.detailTypes!.includes(a.detail_type));
    if (byDetail) return byDetail;
  }
  if (opts.nameLike) {
    return accounts.find(a => opts.nameLike!.test(a.name)
      && (!opts.accountType || a.account_type === opts.accountType));
  }
  return undefined;
}

function accountingRuleSuggestion(
  type: NonNullable<DetectedType>,
  accounts: AccountRow[],
  input: CodingInput,
): Suggestion | null {
  switch (type) {
    case 'credit_card_payment': {
      const card = findAccount(accounts, {
        detailTypes: ['Credit Card'],
        nameLike: /credit\s?card|visa|mastercard|amex/i,
        accountType: 'liability',
      });
      return card ? build(card.id, input, 96, 'accounting_rule', 'Credit card payment') : null;
    }
    case 'payroll': {
      // Prefer a clearing account when the client keeps one -- a payroll
      // withdrawal is not the same thing as payroll expense.
      const clearing = findAccount(accounts, {
        detailTypes: ['Payroll Clearing'],
        nameLike: /payroll\s?clearing/i,
      });
      if (clearing) return build(clearing.id, input, 96, 'accounting_rule', 'Payroll withdrawal');
      const expense = findAccount(accounts, {
        detailTypes: ['Payroll Expenses', 'Payroll Wage Expenses'],
        nameLike: /payroll|salaries|wages/i,
        accountType: 'expense',
      });
      return expense ? build(expense.id, input, 90, 'accounting_rule', 'Payroll') : null;
    }
    case 'loan_payment': {
      // Principal/interest split needs an amortization schedule we do not have,
      // so route to the liability and let a human split it. Deliberately below
      // auto-post so this never posts unattended.
      const loan = findAccount(accounts, {
        detailTypes: ['Notes Payable', 'Loan Payable'],
        nameLike: /loan|mortgage|note\s?payable/i,
        accountType: 'liability',
      });
      return loan
        ? build(loan.id, input, 82, 'accounting_rule', 'Loan payment - split principal and interest')
        : null;
    }
    case 'transfer': {
      // A transfer offsets another cash account, never an expense. Without
      // knowing which one, keep it in the review band.
      const other = accounts.find(a =>
        a.account_type === 'asset'
        && ['Checking', 'Savings', 'Money Market', 'Cash on hand'].includes(a.detail_type ?? '')
      );
      return other ? build(other.id, input, 80, 'accounting_rule', 'Transfer between accounts') : null;
    }
  }
}

/**
 * Resolve the offsetting account(s) for one bank transaction.
 *
 * Layers run in priority order and the first hit wins. Returns null when
 * nothing reached the "suggested" threshold -- the caller leaves the
 * transaction unclassified rather than guessing.
 */
export async function suggestCoding(
  db: Kysely<DB> | Transaction<DB>,
  ctx: ServiceCtx,
  input: CodingInput,
): Promise<Suggestion | null> {
  const businessId = requireBusiness(ctx);
  const vendor = normalizeVendor(input.description);
  const accounts = await activeAccounts(db, businessId);
  const accountIds = new Set(accounts.map(a => a.id));

  // --- Layer 1: learned rule for this client -------------------------------
  if (vendor) {
    const learned = await db.selectFrom('account_coding_memory')
      .selectAll()
      .where('business_id', '=', businessId)
      .where('normalized_vendor', '=', vendor)
      .where('direction', '=', input.direction)
      .where(eb => eb.or([
        eb('bank_account_id', '=', input.bank_account_id),
        eb('bank_account_id', 'is', null),
      ]))
      // Account-scoped rules are more specific than client-wide ones.
      .orderBy(sql`bank_account_id is null`)
      .executeTakeFirst();

    if (learned) {
      const lines = learned.lines as unknown as SuggestionLine[];
      // A learned rule can reference an account that was later deactivated.
      if (lines.length > 0 && lines.every(l => accountIds.has(l.account_id))) {
        return { confidence: 99, source_layer: 'learned_rule', band: confidenceBand(99), lines };
      }
    }
  }

  // --- Layer 2: deterministic accounting rules -----------------------------
  const detected = detectTransactionType(input.description);
  if (detected) {
    const ruled = accountingRuleSuggestion(detected, accounts, input);
    if (ruled) return ruled;
  }

  // --- Layer 3: vendor default account -------------------------------------
  if (vendor) {
    const vendorRow = await db.selectFrom('vendors')
      .select(['default_expense_account_id'])
      .where('business_id', '=', businessId)
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`lower(name) = ${vendor}`)
      .executeTakeFirst();
    const defaultAccount = vendorRow?.default_expense_account_id;
    if (defaultAccount && accountIds.has(defaultAccount)) {
      return build(defaultAccount, input, 90, 'vendor_default');
    }
  }

  // --- Layer 4: how this client coded the same vendor before ---------------
  if (vendor) {
    // Vendor normalization is JS, so it cannot run inside SQL. Pull this
    // client's recently coded transactions and tally them here. Bounded by
    // HISTORY_SCAN_LIMIT so a long-lived client cannot slow the import down.
    const prior = await db.selectFrom('bank_transactions as bt')
      .innerJoin('journal_entries as je', 'je.id', 'bt.matched_journal_entry_id')
      .innerJoin('journal_entry_lines as jel', 'jel.journal_entry_id', 'je.id')
      .innerJoin('chart_of_accounts as coa', 'coa.id', 'jel.account_id')
      .select(['bt.description', 'jel.account_id'])
      .where('bt.business_id', '=', businessId)
      .where('je.status', '=', 'posted')
      // The bank side of the entry is the cash account; the offset is what we
      // are trying to learn, so skip asset rows.
      .where('coa.account_type', '!=', 'asset')
      .where('bt.transaction_date', '>=', sql<string>`(CURRENT_DATE - INTERVAL '24 months')`)
      .orderBy('bt.transaction_date', 'desc')
      .limit(HISTORY_SCAN_LIMIT)
      .execute();

    const tally = new Map<string, number>();
    let total = 0;
    for (const row of prior) {
      if (normalizeVendor(row.description) !== vendor) continue;
      if (!accountIds.has(row.account_id)) continue;
      tally.set(row.account_id, (tally.get(row.account_id) ?? 0) + 1);
      total += 1;
    }

    if (total > 0) {
      const [topAccount, hits] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]!;
      // Scale 70..92 by how consistently this client codes the vendor.
      const confidence = Math.round(70 + (hits / total) * 22);
      return build(topAccount, input, confidence, 'history');
    }
  }

  // --- Layer 5: the extraction model's proposal ----------------------------
  // Validated against the client's CoA: a name the model invented is discarded
  // rather than posted. The model ranks existing accounts, it never creates them.
  if (input.ai_suggested_account) {
    const wanted = input.ai_suggested_account.trim().toLowerCase();
    const match = accounts.find(a =>
      a.name.toLowerCase() === wanted
      || `${a.code} ${a.name}`.toLowerCase() === wanted
      || a.code.toLowerCase() === wanted);
    if (match) return build(match.id, input, 85, 'ai');
  }

  return null;
}

/**
 * Record what an accountant actually chose so the next identical transaction
 * is a layer-1 hit. Called when a suggestion is accepted or corrected.
 */
export async function rememberCoding(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: {
    description: string;
    direction: 'debit' | 'credit';
    bank_account_id: string | null;
    lines: SuggestionLine[];
    was_correction: boolean;
  },
): Promise<void> {
  const businessId = requireBusiness(ctx);
  const vendor = normalizeVendor(input.description);
  if (!vendor || input.lines.length === 0) return;

  await trx.insertInto('account_coding_memory')
    .values({
      business_id: businessId,
      normalized_vendor: vendor,
      direction: input.direction,
      bank_account_id: input.bank_account_id,
      lines: JSON.stringify(input.lines),
      times_applied: 1,
      times_corrected: input.was_correction ? 1 : 0,
      last_applied_at: sql`now()`,
      created_by_user_id: ctx.user_id,
    })
    .onConflict(oc => oc
      .columns(['business_id', 'normalized_vendor', 'direction'])
      .where('bank_account_id', 'is', null)
      .doUpdateSet({
        lines: JSON.stringify(input.lines),
        times_applied: sql`account_coding_memory.times_applied + 1`,
        times_corrected: sql`account_coding_memory.times_corrected + ${input.was_correction ? 1 : 0}`,
        last_applied_at: sql`now()`,
      }))
    .execute();
}
