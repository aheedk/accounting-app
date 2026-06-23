import { type Kysely, sql, type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB, BankRuleSignFilter } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateRuleInput = {
  business_id: string;
  name: string;
  description_contains: string;
  min_amount: string | null;
  max_amount: string | null;
  sign_filter: BankRuleSignFilter;
  offset_account_id: string;
  priority: number;
  bank_account_id: string | null;
};

export type UpdateRuleInput = {
  rule_id: string;
  patch: Partial<{
    name: string;
    description_contains: string;
    min_amount: string | null;
    max_amount: string | null;
    sign_filter: BankRuleSignFilter;
    offset_account_id: string;
    priority: number;
    is_active: boolean;
    bank_account_id: string | null;
  }>;
};

export async function createRule(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateRuleInput) {
  const coa = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.offset_account_id)
    .where('business_id', '=', input.business_id)
    .executeTakeFirst();
  if (!coa) throw new NotFoundError('chart_of_accounts', input.offset_account_id);
  if (!coa.is_active) throw new PreconditionError('offset_account is inactive');

  const row = await trx.insertInto('bank_transaction_rules').values({
    business_id: input.business_id,
    name: input.name,
    description_contains: input.description_contains,
    min_amount: input.min_amount,
    max_amount: input.max_amount,
    sign_filter: input.sign_filter,
    offset_account_id: input.offset_account_id,
    priority: input.priority,
    bank_account_id: input.bank_account_id,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RULE_CREATE,
    entity_type: 'bank_rule',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function updateRule(trx: Transaction<DB>, ctx: ServiceCtx, input: UpdateRuleInput) {
  const before = await trx.selectFrom('bank_transaction_rules').selectAll()
    .where('id', '=', input.rule_id).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('bank_rule', input.rule_id);

  if (input.patch.offset_account_id !== undefined) {
    const coa = await trx.selectFrom('chart_of_accounts').selectAll()
      .where('id', '=', input.patch.offset_account_id)
      .where('business_id', '=', before.business_id)
      .executeTakeFirst();
    if (!coa) throw new NotFoundError('chart_of_accounts', input.patch.offset_account_id);
    if (!coa.is_active) throw new PreconditionError('offset_account is inactive');
  }

  const updated = await trx.updateTable('bank_transaction_rules').set({
    ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
    ...(input.patch.description_contains !== undefined ? { description_contains: input.patch.description_contains } : {}),
    ...(input.patch.min_amount !== undefined ? { min_amount: input.patch.min_amount } : {}),
    ...(input.patch.max_amount !== undefined ? { max_amount: input.patch.max_amount } : {}),
    ...(input.patch.sign_filter !== undefined ? { sign_filter: input.patch.sign_filter } : {}),
    ...(input.patch.offset_account_id !== undefined ? { offset_account_id: input.patch.offset_account_id } : {}),
    ...(input.patch.priority !== undefined ? { priority: input.patch.priority } : {}),
    ...(input.patch.is_active !== undefined ? { is_active: input.patch.is_active } : {}),
    ...(input.patch.bank_account_id !== undefined ? { bank_account_id: input.patch.bank_account_id } : {}),
  }).where('id', '=', input.rule_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RULE_UPDATE,
    entity_type: 'bank_rule',
    entity_id: input.rule_id,
    before,
    after: updated,
  });
  return updated;
}

export async function deleteRule(trx: Transaction<DB>, ctx: ServiceCtx, input: { rule_id: string }) {
  const before = await trx.selectFrom('bank_transaction_rules').selectAll()
    .where('id', '=', input.rule_id).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('bank_rule', input.rule_id);

  await trx.updateTable('bank_transaction_rules').set({ deleted_at: sql`now()` })
    .where('id', '=', input.rule_id).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RULE_DELETE,
    entity_type: 'bank_rule',
    entity_id: input.rule_id,
    before,
    after: null,
  });
}

export async function listRules(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('bank_transaction_rules as btr')
    .innerJoin('chart_of_accounts as a', 'a.id', 'btr.offset_account_id')
    .leftJoin('bank_accounts as ba', 'ba.id', 'btr.bank_account_id')
    .select([
      'btr.id', 'btr.business_id', 'btr.name', 'btr.description_contains',
      'btr.min_amount', 'btr.max_amount', 'btr.sign_filter',
      'btr.offset_account_id', 'btr.priority', 'btr.is_active',
      'btr.bank_account_id',
      'btr.created_at', 'btr.updated_at',
      'a.code as offset_account_code', 'a.name as offset_account_name',
      'ba.name as bank_account_name',
    ])
    .where('btr.business_id', '=', business_id)
    .where('btr.deleted_at', 'is', null)
    .orderBy('btr.priority', 'asc')
    .execute();
}

export async function getRule(db: Kysely<DB>, business_id: string, rule_id: string) {
  const row = await db.selectFrom('bank_transaction_rules as btr')
    .innerJoin('chart_of_accounts as a', 'a.id', 'btr.offset_account_id')
    .leftJoin('bank_accounts as ba', 'ba.id', 'btr.bank_account_id')
    .select([
      'btr.id', 'btr.business_id', 'btr.name', 'btr.description_contains',
      'btr.min_amount', 'btr.max_amount', 'btr.sign_filter',
      'btr.offset_account_id', 'btr.priority', 'btr.is_active',
      'btr.bank_account_id',
      'btr.created_at', 'btr.updated_at',
      'a.code as offset_account_code', 'a.name as offset_account_name',
      'ba.name as bank_account_name',
    ])
    .where('btr.id', '=', rule_id)
    .where('btr.business_id', '=', business_id)
    .where('btr.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('bank_rule', rule_id);
  return row;
}
