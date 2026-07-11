import { type Kysely, type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { record as auditRecord } from '../audit/auditService.js';
import { categorize } from './bankTransactionService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type RulePredicate = {
  description_contains: string;
  min_amount: string | null;
  max_amount: string | null;
  sign_filter: string;
  bank_account_id?: string | null;
};

/** Shared predicate between applyRules and dryRunRule — one source of truth. */
export function ruleMatches(
  rule: RulePredicate,
  txn: { description: string; amount: string; bank_account_id: string },
): boolean {
  const amount = parseFloat(txn.amount);
  const absAmount = Math.abs(amount);
  if (rule.bank_account_id && rule.bank_account_id !== txn.bank_account_id) return false;
  if (rule.sign_filter === 'inflow_only' && amount <= 0) return false;
  if (rule.sign_filter === 'outflow_only' && amount >= 0) return false;
  if (!txn.description.toLowerCase().includes(rule.description_contains.toLowerCase())) return false;
  if (rule.min_amount !== null && absAmount < parseFloat(rule.min_amount)) return false;
  if (rule.max_amount !== null && absAmount > parseFloat(rule.max_amount)) return false;
  return true;
}

export type ApplyRulesInput = {
  business_id: string;
  bank_account_id: string;
};

export type ApplyRulesResult = {
  applied: number;
  rules_tried: number;
};

export async function applyRules(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: ApplyRulesInput,
): Promise<ApplyRulesResult> {
  // 1. Fetch active rules sorted by priority asc
  const rules = await trx.selectFrom('bank_transaction_rules').selectAll()
    .where('business_id', '=', input.business_id)
    .where('is_active', '=', true)
    .where('deleted_at', 'is', null)
    .orderBy('priority', 'asc')
    .orderBy('created_at', 'asc')
    .execute();

  // 2. Fetch unreviewed bank_transactions for the bank_account_id
  const txns = await trx.selectFrom('bank_transactions').selectAll()
    .where('business_id', '=', input.business_id)
    .where('bank_account_id', '=', input.bank_account_id)
    .where('status', '=', 'unreviewed')
    .execute();

  let applied = 0;
  for (const txn of txns) {
    for (const rule of rules) {
      if (!ruleMatches(rule, txn)) continue;
      // Match — categorize
      await categorize(trx, ctx, {
        bank_transaction_id: txn.id,
        offset_account_id: rule.offset_account_id,
        memo: null,
      });
      applied++;
      break; // first match wins
    }
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RULE_APPLY,
    entity_type: 'bank_account',
    entity_id: input.bank_account_id,
    before: null,
    after: { applied, rules_tried: rules.length },
  });

  return { applied, rules_tried: rules.length };
}

export type DryRunResult = {
  matches: number;
  total_unreviewed: number;
  sample: Array<{ id: string; transaction_date: string; description: string; amount: string }>;
};

/**
 * Evaluate a candidate rule against unreviewed transactions. Read-only — no
 * writes, no audit — so the UI can preview match counts before saving.
 */
export async function dryRunRule(
  db: Kysely<DB>, business_id: string, rule: RulePredicate & { sign_filter?: string | null },
): Promise<DryRunResult> {
  let q = db.selectFrom('bank_transactions')
    .select(['id', 'transaction_date', 'description', 'amount', 'bank_account_id'])
    .where('business_id', '=', business_id)
    .where('status', '=', 'unreviewed');
  if (rule.bank_account_id) q = q.where('bank_account_id', '=', rule.bank_account_id);
  const txns = await q.execute();

  const predicate: RulePredicate = {
    description_contains: rule.description_contains,
    min_amount: rule.min_amount ?? null,
    max_amount: rule.max_amount ?? null,
    sign_filter: rule.sign_filter ?? 'any',
    bank_account_id: rule.bank_account_id ?? null,
  };
  const matched = txns.filter(t => ruleMatches(predicate, t));
  return {
    matches: matched.length,
    total_unreviewed: txns.length,
    sample: matched.slice(0, 5).map(t => ({
      id: t.id, transaction_date: t.transaction_date, description: t.description, amount: t.amount,
    })),
  };
}
