import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR, addMoney, subMoney, toMoneyString, equalMoney, isZero } from '@accounting/shared';
import type { DB, JournalEntrySourceType } from '../../db/types.js';
import { BusinessRuleError } from '../../lib/errors.js';
import {
  UnbalancedEntryError,
  ClosedPeriodError,
  InvalidStateTransitionError,
  PreconditionError,
} from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { findPeriodForDate } from './fiscalPeriodService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type LineInput = {
  account_id: string;
  debit: string;
  credit: string;
  memo: string | null;
};

export type PostJournalEntryInput = {
  business_id: string;
  entry_date: string;
  source_type: JournalEntrySourceType;
  source_id?: string | null;
  memo: string | null;
  reference?: string | null;
  lines: LineInput[];
};

function assertBalanced(lines: LineInput[]) {
  if (lines.length < 2) throw new PreconditionError('Journal entry must have at least 2 lines');
  let totalD = '0.0000';
  let totalC = '0.0000';
  for (const l of lines) {
    if (parseFloat(l.debit) > 0 && parseFloat(l.credit) > 0) {
      throw new PreconditionError('A line cannot have both debit and credit', { line: l });
    }
    if (parseFloat(l.debit) === 0 && parseFloat(l.credit) === 0) {
      throw new PreconditionError('A line must have a debit or credit > 0', { line: l });
    }
    totalD = toMoneyString(addMoney(totalD, l.debit));
    totalC = toMoneyString(addMoney(totalC, l.credit));
  }
  if (!equalMoney(totalD, totalC)) {
    throw new UnbalancedEntryError('(pre-insert)', totalD, totalC);
  }
  if (isZero(totalD)) {
    throw new PreconditionError('Journal entry total cannot be zero');
  }
}

export async function postJournalEntry(
  trx: Transaction<DB>, ctx: ServiceCtx, input: PostJournalEntryInput,
) {
  assertBalanced(input.lines);

  const period = await findPeriodForDate(trx as unknown as Kysely<DB>, input.business_id, input.entry_date);
  if (!period) {
    throw new PreconditionError(`No fiscal period covers ${input.entry_date}; create periods first`);
  }
  if (period.status === 'closed' && (await currentSetting(trx, 'app.admin_override')) !== 'on') {
    throw new ClosedPeriodError(period.id, period.closed_at?.toString());
  }

  const je = await trx.insertInto('journal_entries').values({
    business_id: input.business_id,
    period_id: period.id,
    entry_date: input.entry_date,
    memo: input.memo,
    reference: input.reference ?? null,
    status: 'draft',
    source_type: input.source_type,
    source_id: input.source_id ?? null,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  let n = 1;
  for (const l of input.lines) {
    await trx.insertInto('journal_entry_lines').values({
      journal_entry_id: je.id,
      line_number: n++,
      account_id: l.account_id,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo,
    }).execute();
  }

  const posted = await trx.updateTable('journal_entries')
    .set({ status: 'posted', posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', je.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.JOURNAL_ENTRY_POST,
    entity_type: 'journal_entry',
    entity_id: je.id,
    before: null,
    after: posted,
  });

  return posted;
}

export async function voidJournalEntry(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { journal_entry_id: string; void_reason: string },
) {
  const orig = await trx.selectFrom('journal_entries').selectAll()
    .where('id', '=', input.journal_entry_id).executeTakeFirst();
  if (!orig) throw new BusinessRuleError(ERR.NOT_FOUND, `Journal entry ${input.journal_entry_id} not found`);
  if (orig.status !== 'posted') throw new InvalidStateTransitionError('journal_entry', orig.id, orig.status, 'voided');

  const period = await trx.selectFrom('fiscal_periods').selectAll().where('id', '=', orig.period_id).executeTakeFirstOrThrow();
  if (period.status === 'closed' && (await currentSetting(trx, 'app.admin_override')) !== 'on') {
    throw new ClosedPeriodError(period.id, period.closed_at?.toString());
  }

  const lines = await trx.selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', orig.id).orderBy('line_number').execute();

  const today = new Date().toISOString().slice(0, 10);
  const reversalPeriod = await findPeriodForDate(trx as unknown as Kysely<DB>, orig.business_id, today)
                       ?? await findPeriodForDate(trx as unknown as Kysely<DB>, orig.business_id, orig.entry_date);
  if (!reversalPeriod) throw new PreconditionError('No fiscal period available for reversal');
  if (reversalPeriod.status === 'closed' && (await currentSetting(trx, 'app.admin_override')) !== 'on') {
    throw new ClosedPeriodError(reversalPeriod.id);
  }

  const reversal = await trx.insertInto('journal_entries').values({
    business_id: orig.business_id,
    period_id: reversalPeriod.id,
    entry_date: reversalPeriod.starts_on <= today && today <= reversalPeriod.ends_on ? today : orig.entry_date,
    memo: `Reversal of ${orig.id}: ${input.void_reason}`,
    reference: orig.reference,
    status: 'draft',
    source_type: 'reversal',
    source_id: orig.id,
    reversed_entry_id: orig.id,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  let n = 1;
  for (const l of lines) {
    await trx.insertInto('journal_entry_lines').values({
      journal_entry_id: reversal.id,
      line_number: n++,
      account_id: l.account_id,
      debit: l.credit,
      credit: l.debit,
      memo: l.memo,
    }).execute();
  }

  const reversalPosted = await trx.updateTable('journal_entries')
    .set({ status: 'posted', posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', reversal.id)
    .returningAll().executeTakeFirstOrThrow();

  await sql`SELECT set_config('app.allow_void', 'on', true)`.execute(trx);
  const voided = await trx.updateTable('journal_entries')
    .set({ status: 'voided', voided_at: sql`now()`, voided_by_user_id: ctx.user_id, void_reason: input.void_reason })
    .where('id', '=', orig.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.JOURNAL_ENTRY_VOID,
    entity_type: 'journal_entry',
    entity_id: orig.id,
    before: orig,
    after: voided,
  });
  await auditRecord(trx, ctx, {
    action: AUDIT.JOURNAL_ENTRY_REVERSE,
    entity_type: 'journal_entry',
    entity_id: reversalPosted.id,
    before: null,
    after: reversalPosted,
  });

  return reversalPosted;
}

export async function computeAccountBalance(
  db: Kysely<DB>, q: { account_id: string; as_of: string },
): Promise<string> {
  const row = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      fn.sum<string>('jel.debit').as('total_debit'),
      fn.sum<string>('jel.credit').as('total_credit'),
    ])
    .where('jel.account_id', '=', q.account_id)
    .where('je.status', '=', 'posted')
    .where('je.entry_date', '<=', q.as_of)
    .executeTakeFirstOrThrow();
  const debit = row.total_debit ?? '0';
  const credit = row.total_credit ?? '0';
  return toMoneyString(subMoney(debit, credit));
}

async function currentSetting(trx: Transaction<DB>, key: string): Promise<string | null> {
  const r = await sql<{ v: string | null }>`SELECT current_setting(${key}, true) AS v`.execute(trx);
  return r.rows[0]?.v ?? null;
}
