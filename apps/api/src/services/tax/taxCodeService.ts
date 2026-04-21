import { Kysely, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateTaxCodeInput = {
  business_id: string;
  code: string;
  name: string;
  tax_payable_account_id: string;
  initial_rate: { rate: number; effective_from: string; effective_to: string | null };
};

export async function createTaxCode(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateTaxCodeInput) {
  const dup = await trx.selectFrom('tax_codes').select('id')
    .where('business_id', '=', input.business_id).where('code', '=', input.code).executeTakeFirst();
  if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Tax code ${input.code} already exists`);

  const acct = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.tax_payable_account_id).executeTakeFirst();
  if (!acct || acct.business_id !== input.business_id || acct.account_type !== 'liability') {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'tax_payable_account must be a liability account in this business');
  }

  const tc = await trx.insertInto('tax_codes').values({
    business_id: input.business_id,
    code: input.code, name: input.name,
    tax_payable_account_id: input.tax_payable_account_id,
  }).returningAll().executeTakeFirstOrThrow();

  await trx.insertInto('tax_rates').values({
    tax_code_id: tc.id,
    rate: String(input.initial_rate.rate),
    effective_from: input.initial_rate.effective_from,
    effective_to: input.initial_rate.effective_to,
  }).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.TAX_CODE_CREATE, entity_type: 'tax_code', entity_id: tc.id,
    before: null, after: tc,
  });
  return tc;
}

export async function getEffectiveRate(db: Kysely<DB>, tax_code_id: string, as_of: string): Promise<string> {
  const row = await db.selectFrom('tax_rates').selectAll()
    .where('tax_code_id', '=', tax_code_id)
    .where('effective_from', '<=', as_of)
    .where(eb => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', as_of)]))
    .orderBy('effective_from', 'desc')
    .executeTakeFirst();
  if (!row) throw new BusinessRuleError(ERR.NOT_FOUND, `No tax rate for code ${tax_code_id} on ${as_of}`);
  return row.rate;
}

export async function listTaxCodes(db: Kysely<DB>, business_id: string) {
  const codes = await db.selectFrom('tax_codes').selectAll()
    .where('business_id', '=', business_id)
    .orderBy('code').execute();
  const out = await Promise.all(codes.map(async c => {
    const rate = await db.selectFrom('tax_rates').select('rate')
      .where('tax_code_id', '=', c.id)
      .where('effective_from', '<=', new Date().toISOString().slice(0, 10))
      .orderBy('effective_from', 'desc').executeTakeFirst();
    return { ...c, current_rate: rate?.rate ?? null };
  }));
  return out;
}
