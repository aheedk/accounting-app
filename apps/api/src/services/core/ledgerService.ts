import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR, addMoney, subMoney, toMoneyString, equalMoney, hasMinRole, isZero } from '@accounting/shared';
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
import { nextCounter, reserveCounterAtLeast } from './numberingService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type LineInput = {
  account_id: string;
  debit: string;
  credit: string;
  memo: string | null;
  name?: string | null;
  class_name?: string | null;
};

export type PostJournalEntryInput = {
  business_id: string;
  entry_date: string;
  journal_number?: string | null;
  source_type: JournalEntrySourceType;
  source_id?: string | null;
  memo: string | null;
  reference?: string | null;
  corrected_from_entry_id?: string | null;
  lines: LineInput[];
};

export type CorrectJournalEntryInput = {
  journal_entry_id: string;
  replacement: PostJournalEntryInput;
};

export type JournalEntrySourceGuard = {
  source_type: JournalEntrySourceType;
  source_id: string;
  allow_legacy_manual?: boolean;
};

export type VoidJournalEntryInput = {
  journal_entry_id: string;
  void_reason: string;
  reversal_date?: string;
  source_guard?: JournalEntrySourceGuard;
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

  // Validate account tenancy and posting eligibility at the ledger choke point
  // so every source flow receives the same protection.
  const accountIds = [...new Set(input.lines.map(line => line.account_id))];
  const postingAccounts = await trx.selectFrom('chart_of_accounts')
    .select(['id', 'code', 'name', 'is_locked'])
    .where('business_id', '=', input.business_id)
    .where('id', 'in', accountIds)
    .where('is_active', '=', true)
    .execute();
  if (postingAccounts.length !== accountIds.length) {
    throw new PreconditionError('Every journal line must use an active account from this business');
  }
  const lockedAccounts = postingAccounts.filter(account => account.is_locked);
  if (lockedAccounts.length > 0) {
    throw new PreconditionError(
      `Account ${lockedAccounts[0]!.code} ${lockedAccounts[0]!.name} is locked and cannot accept new postings`,
      { accounts: lockedAccounts.map(a => a.code) },
    );
  }

  const period = await findPeriodForDate(trx as unknown as Kysely<DB>, input.business_id, input.entry_date);
  if (!period) {
    throw new PreconditionError(`No fiscal period covers ${input.entry_date}; create periods first`);
  }
  if (period.status === 'closed' && (await currentSetting(trx, 'app.admin_override')) !== 'on') {
    throw new ClosedPeriodError(period.id, period.closed_at?.toString());
  }

  const requestedNumber = input.journal_number?.trim() || null;
  let journalNumber: string;
  if (requestedNumber) {
    const numericNumber = /^[1-9]\d*$/.test(requestedNumber) ? Number(requestedNumber) : 0;
    await reserveCounterAtLeast(trx, input.business_id, 'journal_entry', numericNumber);
    const duplicate = await trx.selectFrom('journal_entries').select('id')
      .where('business_id', '=', input.business_id)
      .where('journal_number', '=', requestedNumber)
      .where('status', '<>', 'voided')
      .executeTakeFirst();
    if (duplicate) {
      throw new BusinessRuleError(
        ERR.DUPLICATE_RESOURCE,
        `Journal number ${requestedNumber} already exists`,
      );
    }
    journalNumber = requestedNumber;
  } else {
    journalNumber = String(await nextCounter(trx, input.business_id, 'journal_entry'));
  }

  const je = await trx.insertInto('journal_entries').values({
    business_id: input.business_id,
    period_id: period.id,
    entry_date: input.entry_date,
    journal_number: journalNumber,
    memo: input.memo,
    reference: input.reference ?? null,
    status: 'draft',
    source_type: input.source_type,
    source_id: input.source_id ?? null,
    corrected_from_entry_id: input.corrected_from_entry_id ?? null,
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
      name: l.name ?? null,
      class_name: l.class_name ?? null,
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
  input: VoidJournalEntryInput,
) {
  const orig = await trx.selectFrom('journal_entries').selectAll()
    .where('id', '=', input.journal_entry_id)
    .where('business_id', '=', ctx.business_id)
    .forUpdate()
    .executeTakeFirst();
  if (!orig) throw new BusinessRuleError(ERR.NOT_FOUND, `Journal entry ${input.journal_entry_id} not found`);
  if (orig.status !== 'posted') throw new InvalidStateTransitionError('journal_entry', orig.id, orig.status, 'voided');

  const sourceGuardMatches = input.source_guard && (
    (orig.source_type === input.source_guard.source_type && orig.source_id === input.source_guard.source_id)
    || (
      input.source_guard.allow_legacy_manual === true
      && orig.source_type === 'manual'
      && orig.source_id === null
    )
  );
  if (input.source_guard && !sourceGuardMatches) {
    throw new BusinessRuleError(
      ERR.IMMUTABLE_RECORD,
      'Journal entry does not belong to the source transaction requesting the void',
    );
  }
  if (!input.source_guard && await isSourceGeneratedJournalEntry(trx, orig)) {
    throw new BusinessRuleError(
      ERR.IMMUTABLE_RECORD,
      'Source-generated journal entries must be voided from their source transaction',
    );
  }
  if (await hasPostedReversal(trx, orig.business_id, orig.id)) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'Journal entry has already been reversed');
  }

  const period = await trx.selectFrom('fiscal_periods').selectAll().where('id', '=', orig.period_id).executeTakeFirstOrThrow();
  if (period.status === 'closed' && (await currentSetting(trx, 'app.admin_override')) !== 'on') {
    throw new ClosedPeriodError(period.id, period.closed_at?.toString());
  }

  const lines = await trx.selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', orig.id).orderBy('line_number').execute();

  const today = new Date().toISOString().slice(0, 10);
  const reversalDate = input.reversal_date ?? today;
  const reversalPeriod = await findPeriodForDate(trx as unknown as Kysely<DB>, orig.business_id, reversalDate)
                       ?? await findPeriodForDate(trx as unknown as Kysely<DB>, orig.business_id, orig.entry_date);
  if (!reversalPeriod) throw new PreconditionError('No fiscal period available for reversal');
  if (reversalPeriod.status === 'closed' && (await currentSetting(trx, 'app.admin_override')) !== 'on') {
    throw new ClosedPeriodError(reversalPeriod.id);
  }
  const reversalJournalNumber = String(await nextCounter(trx, orig.business_id, 'journal_entry'));

  const reversal = await trx.insertInto('journal_entries').values({
    business_id: orig.business_id,
    period_id: reversalPeriod.id,
    entry_date: reversalPeriod.starts_on <= reversalDate && reversalDate <= reversalPeriod.ends_on ? reversalDate : orig.entry_date,
    journal_number: reversalJournalNumber,
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
      name: l.name,
      class_name: l.class_name,
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
    .where('business_id', '=', ctx.business_id)
    .where('status', '=', 'posted')
    .returningAll().executeTakeFirst();
  if (!voided) {
    throw new InvalidStateTransitionError('journal_entry', orig.id, orig.status, 'voided');
  }

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

export async function reverseJournalEntry(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { journal_entry_id: string },
) {
  if (!hasMinRole(ctx.effective_role, 'accountant')) {
    throw new BusinessRuleError(ERR.FORBIDDEN, 'Accountant access is required to reverse journal entries');
  }

  const original = await trx.selectFrom('journal_entries').selectAll()
    .where('id', '=', input.journal_entry_id)
    .where('business_id', '=', ctx.business_id)
    .forUpdate()
    .executeTakeFirst();
  if (!original) {
    throw new BusinessRuleError(ERR.NOT_FOUND, `Journal entry ${input.journal_entry_id} not found`);
  }
  if (original.status !== 'posted') {
    throw new InvalidStateTransitionError('journal_entry', original.id, original.status, 'reversed');
  }
  if (await isSourceGeneratedJournalEntry(trx, original)) {
    throw new BusinessRuleError(
      ERR.IMMUTABLE_RECORD,
      'Source-generated journal entries must be reversed from their source transaction',
    );
  }
  if (await hasPostedReversal(trx, original.business_id, original.id)) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'Journal entry has already been reversed');
  }

  const reversalDate = firstDayOfNextMonth(original.entry_date);
  const reversalPeriod = await findPeriodForDate(
    trx as unknown as Kysely<DB>,
    original.business_id,
    reversalDate,
  );
  if (!reversalPeriod) {
    throw new PreconditionError(`No fiscal period covers reversal date ${reversalDate}`);
  }
  if (reversalPeriod.status === 'closed' && (await currentSetting(trx, 'app.admin_override')) !== 'on') {
    throw new ClosedPeriodError(reversalPeriod.id, reversalPeriod.closed_at?.toString());
  }

  const lines = await trx.selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', original.id)
    .orderBy('line_number')
    .execute();
  const reversal = await trx.insertInto('journal_entries').values({
    business_id: original.business_id,
    period_id: reversalPeriod.id,
    entry_date: reversalDate,
    journal_number: `${original.journal_number}R`,
    memo: original.memo,
    reference: original.reference,
    status: 'draft',
    source_type: 'reversal',
    source_id: original.id,
    reversed_entry_id: original.id,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  for (const line of lines) {
    await trx.insertInto('journal_entry_lines').values({
      journal_entry_id: reversal.id,
      line_number: line.line_number,
      account_id: line.account_id,
      debit: line.credit,
      credit: line.debit,
      memo: line.memo,
      name: line.name,
      class_name: line.class_name,
    }).execute();
  }

  const posted = await trx.updateTable('journal_entries')
    .set({ status: 'posted', posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', reversal.id)
    .where('business_id', '=', ctx.business_id)
    .where('status', '=', 'draft')
    .returningAll()
    .executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.JOURNAL_ENTRY_REVERSE,
    entity_type: 'journal_entry',
    entity_id: posted.id,
    before: null,
    after: posted,
  });
  return posted;
}

export async function correctJournalEntry(
  trx: Transaction<DB>, ctx: ServiceCtx, input: CorrectJournalEntryInput,
) {
  if (!hasMinRole(ctx.effective_role, 'accountant')) {
    throw new BusinessRuleError(ERR.FORBIDDEN, 'Accountant access is required to correct journal entries');
  }
  if (input.replacement.business_id !== ctx.business_id) {
    throw new BusinessRuleError(ERR.NOT_FOUND, 'Journal entry not found');
  }

  const originalBefore = await trx.selectFrom('journal_entries').selectAll()
    .where('id', '=', input.journal_entry_id)
    .where('business_id', '=', ctx.business_id)
    .forUpdate()
    .executeTakeFirst();
  if (!originalBefore) {
    throw new BusinessRuleError(ERR.NOT_FOUND, `Journal entry ${input.journal_entry_id} not found`);
  }
  if (originalBefore.status !== 'posted') {
    throw new InvalidStateTransitionError('journal_entry', originalBefore.id, originalBefore.status, 'voided');
  }
  if (originalBefore.source_type !== 'manual' && originalBefore.source_type !== 'adjustment') {
    throw new BusinessRuleError(
      ERR.IMMUTABLE_RECORD,
      'Source-generated and reversing journal entries must be corrected from their source transaction',
    );
  }
  if (await isSourceGeneratedJournalEntry(trx, originalBefore)) {
    throw new BusinessRuleError(
      ERR.IMMUTABLE_RECORD,
      'Source-generated journal entries must be corrected from their source transaction',
    );
  }
  if (input.replacement.source_type !== 'manual' && input.replacement.source_type !== 'adjustment') {
    throw new BusinessRuleError(ERR.IMMUTABLE_RECORD, 'A corrected journal entry must be manual or adjusting');
  }

  const originalLines = await trx.selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', originalBefore.id)
    .orderBy('line_number')
    .execute();

  const reversal = await voidJournalEntry(trx, ctx, {
    journal_entry_id: originalBefore.id,
    void_reason: 'Corrected through journal entry editor',
    reversal_date: originalBefore.entry_date,
  });
  const correctedEntry = await postJournalEntry(trx, ctx, {
    ...input.replacement,
    corrected_from_entry_id: originalBefore.id,
  });
  const original = await trx.selectFrom('journal_entries').selectAll()
    .where('id', '=', originalBefore.id)
    .executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.JOURNAL_ENTRY_UPDATE,
    entity_type: 'journal_entry',
    entity_id: originalBefore.id,
    before: { entry: originalBefore, lines: originalLines },
    after: {
      original_id: originalBefore.id,
      reversal_id: reversal.id,
      corrected_entry_id: correctedEntry.id,
    },
  });

  return { original, reversal, corrected_entry: correctedEntry };
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
    // Voids are reversal-based: the original flips to 'voided' and a posted
    // reversal cancels it. Both legs must be counted or a void flips the sign
    // of the entry's effect instead of nulling it. Drafts stay excluded.
    .where('je.status', 'in', ['posted', 'voided'])
    .where('je.entry_date', '<=', q.as_of)
    .executeTakeFirstOrThrow();
  const debit = row.total_debit ?? '0';
  const credit = row.total_credit ?? '0';
  return toMoneyString(subMoney(debit, credit));
}

export type TrialBalanceRow = {
  account_id: string;
  code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  total_debit: string;
  total_credit: string;
  net: string;
};

export async function computeTrialBalance(
  db: Kysely<DB>, q: { business_id: string; as_of: string },
): Promise<{ rows: TrialBalanceRow[]; totals: { total_debit: string; total_credit: string } }> {
  const rows = await db.selectFrom('chart_of_accounts as a')
    .leftJoin('journal_entry_lines as jel', 'jel.account_id', 'a.id')
    .leftJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      'a.id as account_id', 'a.code', 'a.name', 'a.account_type',
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('a.business_id', '=', q.business_id)
    .where(eb => eb.or([
      eb('je.id', 'is', null),
      // 'voided' included alongside 'posted': see computeAccountBalance — the
      // posted reversal cancels the voided original, keeping as-of math right.
      eb.and([eb('je.status', 'in', ['posted', 'voided']), eb('je.entry_date', '<=', q.as_of)]),
    ]))
    .groupBy(['a.id', 'a.code', 'a.name', 'a.account_type'])
    .orderBy('a.code')
    .execute();

  let totalD = '0.0000', totalC = '0.0000';
  const out: TrialBalanceRow[] = rows.map(r => {
    const net = toMoneyString(subMoney(r.total_debit ?? '0', r.total_credit ?? '0'));
    totalD = toMoneyString(addMoney(totalD, r.total_debit ?? '0'));
    totalC = toMoneyString(addMoney(totalC, r.total_credit ?? '0'));
    return {
      account_id: r.account_id,
      code: r.code,
      name: r.name,
      account_type: r.account_type as 'asset' | 'liability' | 'equity' | 'revenue' | 'expense',
      total_debit: toMoneyString(r.total_debit ?? '0'),
      total_credit: toMoneyString(r.total_credit ?? '0'),
      net,
    };
  });
  return { rows: out, totals: { total_debit: totalD, total_credit: totalC } };
}

async function currentSetting(trx: Transaction<DB>, key: string): Promise<string | null> {
  const r = await sql<{ v: string | null }>`SELECT current_setting(${key}, true) AS v`.execute(trx);
  return r.rows[0]?.v ?? null;
}

function firstDayOfNextMonth(entryDate: string): string {
  const [yearText, monthText] = entryDate.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (month === 12) return `${year + 1}-01-01`;
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

async function hasPostedReversal(
  db: Kysely<DB>,
  businessId: string,
  journalEntryId: string,
): Promise<boolean> {
  const reversal = await db.selectFrom('journal_entries').select('id')
    .where('business_id', '=', businessId)
    .where('reversed_entry_id', '=', journalEntryId)
    .where('status', '=', 'posted')
    .executeTakeFirst();
  return reversal !== undefined;
}

export async function isSourceGeneratedJournalEntry(
  trx: Kysely<DB>,
  entry: { id: string; source_type: JournalEntrySourceType; source_id: string | null },
): Promise<boolean> {
  if (entry.source_type !== 'manual' && entry.source_type !== 'adjustment') return true;
  if (entry.source_id !== null) return true;

  // Older source services posted entries as unlinked "manual" rows. Keep
  // those rows protected by checking the source-table back-links as well.
  const linked = await sql<{ is_linked: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM expense_transactions WHERE journal_entry_id = ${entry.id}
      UNION ALL
      SELECT 1 FROM pay_runs WHERE journal_entry_id = ${entry.id}
      UNION ALL
      SELECT 1 FROM payroll_tax_liabilities WHERE payment_journal_entry_id = ${entry.id}
      UNION ALL
      SELECT 1 FROM bank_transactions WHERE matched_journal_entry_id = ${entry.id}
      UNION ALL
      SELECT 1 FROM integration_inbox WHERE matched_journal_entry_id = ${entry.id}
      UNION ALL
      SELECT 1 FROM depreciation_entries WHERE journal_entry_id = ${entry.id}
    ) AS is_linked
  `.execute(trx);
  return linked.rows[0]?.is_linked === true;
}
