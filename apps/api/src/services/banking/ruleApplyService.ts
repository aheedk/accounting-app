import { type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { record as auditRecord } from '../audit/auditService.js';
import { categorize } from './bankTransactionService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

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
    const amount = parseFloat(txn.amount);
    const absAmount = Math.abs(amount);
    for (const rule of rules) {
      // Sign filter
      if (rule.sign_filter === 'inflow_only' && amount <= 0) continue;
      if (rule.sign_filter === 'outflow_only' && amount >= 0) continue;
      // Description substring (case-insensitive)
      if (!txn.description.toLowerCase().includes(rule.description_contains.toLowerCase())) continue;
      // Amount range
      if (rule.min_amount !== null && absAmount < parseFloat(rule.min_amount)) continue;
      if (rule.max_amount !== null && absAmount > parseFloat(rule.max_amount)) continue;
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
