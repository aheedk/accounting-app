import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB, AccountType } from '../../db/types.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateAccountInput = {
  business_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  parent_id: string | null;
  detail_type?: string | null;
  description?: string | null;
};

export async function createAccount(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateAccountInput) {
  const dup = await trx.selectFrom('chart_of_accounts')
    .select('id')
    .where('business_id', '=', input.business_id)
    .where('code', '=', input.code)
    .executeTakeFirst();
  if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Account code ${input.code} already exists`);

  const row = await trx.insertInto('chart_of_accounts').values({
    business_id: input.business_id,
    code: input.code,
    name: input.name,
    account_type: input.account_type,
    parent_id: input.parent_id,
    detail_type: input.detail_type ?? null,
    description: input.description ?? null,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.COA_CREATE,
    entity_type: 'chart_of_account',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function updateAccount(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { account_id: string; patch: { name?: string; parent_id?: string | null; is_active?: boolean; detail_type?: string | null; description?: string | null } },
) {
  const row = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.account_id).executeTakeFirst();
  if (!row) throw new BusinessRuleError(ERR.NOT_FOUND, `Account ${input.account_id} not found`);

  if (row.is_system) {
    if (input.patch.name !== undefined || input.patch.parent_id !== undefined) {
      throw new PreconditionError('System accounts cannot have name or parent changed', { code: row.code });
    }
  }

  if (input.patch.parent_id === input.account_id) {
    throw new PreconditionError('parent_id cannot equal account id (self-reference)');
  }

  const updated = await trx.updateTable('chart_of_accounts')
    .set({
      ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
      ...(input.patch.parent_id !== undefined ? { parent_id: input.patch.parent_id } : {}),
      ...(input.patch.is_active !== undefined ? { is_active: input.patch.is_active } : {}),
      ...(input.patch.detail_type !== undefined ? { detail_type: input.patch.detail_type } : {}),
      ...(input.patch.description !== undefined ? { description: input.patch.description } : {}),
    })
    .where('id', '=', input.account_id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: input.patch.is_active === false ? AUDIT.COA_DEACTIVATE : AUDIT.COA_UPDATE,
    entity_type: 'chart_of_account',
    entity_id: input.account_id,
    before: row,
    after: updated,
  });
  return updated;
}

export async function seedDefaultCoa(trx: Transaction<DB>, ctx: ServiceCtx, input: { business_id: string }) {
  await sql`SELECT seed_default_coa(${input.business_id}::uuid)`.execute(trx);
  const inserted = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', input.business_id).execute();
  for (const row of inserted) {
    await auditRecord(trx, ctx, {
      action: AUDIT.COA_CREATE,
      entity_type: 'chart_of_account',
      entity_id: row.id,
      before: null,
      after: row,
    });
  }
}

export async function listAccounts(db: Kysely<DB>, q: { business_id: string; include_inactive?: boolean }) {
  let query = db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', q.business_id);
  if (!q.include_inactive) query = query.where('is_active', '=', true);
  return query.orderBy('code', 'asc').execute();
}

export async function getSystemAccount(db: Kysely<DB>, business_id: string, code: string) {
  const row = await db.selectFrom('chart_of_accounts')
    .selectAll()
    .where('business_id', '=', business_id)
    .where('code', '=', code)
    .where('is_system', '=', true)
    .executeTakeFirst();
  if (!row) throw new BusinessRuleError(ERR.NOT_FOUND, `System account ${code} not found for business ${business_id}`);
  return row;
}
