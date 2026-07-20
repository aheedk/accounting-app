import { sql, type Kysely, type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateBankAccountInput = {
  business_id: string;
  name: string;
  institution: string | null;
  account_last_four: string | null;
  cash_account_id: string;
};

export type UpdateBankAccountInput = {
  bank_account_id: string;
  patch: Partial<{
    name: string;
    institution: string | null;
    account_last_four: string | null;
    is_active: boolean;
  }>;
};

export async function createBankAccount(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateBankAccountInput) {
  const coa = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.cash_account_id).where('business_id', '=', input.business_id).executeTakeFirst();
  if (!coa) throw new NotFoundError('chart_of_accounts', input.cash_account_id);
  if (coa.account_type !== 'asset') throw new PreconditionError('cash_account must be an asset account');

  const row = await trx.insertInto('bank_accounts').values({
    business_id: input.business_id,
    name: input.name,
    institution: input.institution,
    account_last_four: input.account_last_four,
    cash_account_id: input.cash_account_id,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_ACCOUNT_CREATE,
    entity_type: 'bank_account',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function updateBankAccount(trx: Transaction<DB>, ctx: ServiceCtx, input: UpdateBankAccountInput) {
  const before = await trx.selectFrom('bank_accounts').selectAll()
    .where('id', '=', input.bank_account_id).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('bank_account', input.bank_account_id);

  const updated = await trx.updateTable('bank_accounts').set({
    ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
    ...(input.patch.institution !== undefined ? { institution: input.patch.institution } : {}),
    ...(input.patch.account_last_four !== undefined ? { account_last_four: input.patch.account_last_four } : {}),
    ...(input.patch.is_active !== undefined ? { is_active: input.patch.is_active } : {}),
  }).where('id', '=', input.bank_account_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_ACCOUNT_UPDATE,
    entity_type: 'bank_account',
    entity_id: input.bank_account_id,
    before,
    after: updated,
  });
  return updated;
}

export async function listBankAccounts(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('bank_accounts as ba')
    .innerJoin('chart_of_accounts as a', 'a.id', 'ba.cash_account_id')
    .select(eb => [
      'ba.id', 'ba.name', 'ba.institution', 'ba.account_last_four',
      'ba.cash_account_id', 'ba.is_active',
      'a.code as cash_account_code', 'a.name as cash_account_name',
      // Feed-side balance: sum of imported transactions, minus rows the user excluded.
      eb.selectFrom('bank_transactions as bt')
        .select(({ fn }) => fn.coalesce(fn.sum<string>('bt.amount'), sql.lit('0')).as('v'))
        .whereRef('bt.bank_account_id', '=', 'ba.id')
        .where('bt.status', '!=', 'excluded')
        .as('bank_balance'),
    ])
    .where('ba.business_id', '=', business_id)
    .where('ba.deleted_at', 'is', null)
    .orderBy('ba.name')
    .execute();
}

export async function getBankAccount(db: Kysely<DB>, business_id: string, bank_account_id: string) {
  const row = await db.selectFrom('bank_accounts as ba')
    .innerJoin('chart_of_accounts as a', 'a.id', 'ba.cash_account_id')
    .select([
      'ba.id', 'ba.business_id', 'ba.name', 'ba.institution', 'ba.account_last_four',
      'ba.cash_account_id', 'ba.is_active', 'ba.created_at', 'ba.updated_at',
      'a.code as cash_account_code', 'a.name as cash_account_name',
    ])
    .where('ba.id', '=', bank_account_id)
    .where('ba.business_id', '=', business_id)
    .where('ba.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('bank_account', bank_account_id);
  return row;
}

