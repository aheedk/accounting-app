import { sql, type Transaction, type Kysely } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB, PayrollTaxStatus, PayrollTaxPeriod } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry } from '../core/ledgerService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export async function recordLiability(trx: Transaction<DB>, ctx: ServiceCtx, input: {
  business_id: string;
  period: PayrollTaxPeriod;
  period_start: string;
  period_end: string;
  liability_account_id: string;
  amount: string;
  notes?: string | null;
}) {
  const row = await trx.insertInto('payroll_tax_liabilities').values({
    business_id: input.business_id,
    period: input.period,
    period_start: input.period_start,
    period_end: input.period_end,
    liability_account_id: input.liability_account_id,
    amount: input.amount,
    notes: input.notes ?? null,
  }).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.PAYROLL_TAX_RECORD,
    entity_type: 'payroll_tax_liability', entity_id: row.id,
    before: null, after: row,
  });
  return row;
}

export async function payLiability(trx: Transaction<DB>, ctx: ServiceCtx, input: {
  liability_id: string;
  cash_account_id: string;
  payment_date: string;
}) {
  const before = await trx.selectFrom('payroll_tax_liabilities').selectAll()
    .where('id', '=', input.liability_id).executeTakeFirst();
  if (!before) throw new NotFoundError('payroll_tax_liability', input.liability_id);
  if (before.status === 'paid') {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'liability already paid');
  }

  // Post JE: DR liability_account / CR cash_account
  const je = await postJournalEntry(trx, ctx, {
    business_id: before.business_id,
    entry_date: input.payment_date,
    source_type: 'manual',
    memo: `Payroll tax payment ${before.period_start}-${before.period_end}`,
    reference: null,
    lines: [
      { account_id: before.liability_account_id, debit: before.amount, credit: '0', memo: null },
      { account_id: input.cash_account_id, debit: '0', credit: before.amount, memo: null },
    ],
  });

  const updated = await trx.updateTable('payroll_tax_liabilities').set({
    status: 'paid',
    paid_at: sql`now()`,
    payment_journal_entry_id: je.id,
  }).where('id', '=', input.liability_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.PAYROLL_TAX_PAY,
    entity_type: 'payroll_tax_liability', entity_id: updated.id,
    before, after: updated,
  });
  return updated;
}

export async function listLiabilities(db: Kysely<DB>, business_id: string, opts: { status?: PayrollTaxStatus } = {}) {
  let q = db.selectFrom('payroll_tax_liabilities').selectAll().where('business_id', '=', business_id);
  if (opts.status) q = q.where('status', '=', opts.status);
  return q.orderBy('period_end', 'desc').execute();
}
