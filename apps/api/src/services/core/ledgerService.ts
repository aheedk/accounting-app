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
  transaction_type?: string | null;
  payee_name?: string | null;
  memo: string | null;
  reference?: string | null;
  corrected_from_entry_id?: string | null;
  lines: LineInput[];
};

export type UpdateJournalEntryInput = {
  journal_entry_id: string;
  replacement: PostJournalEntryInput;
  /**
   * Lets the owning source service edit its own entry in place. Without it
   * only standalone manual/adjusting entries are editable.
   */
  source_guard?: JournalEntrySourceGuard;
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

// Validate account tenancy and posting eligibility at the ledger choke point
// so every source flow receives the same protection.
async function assertPostableAccounts(
  trx: Transaction<DB>, businessId: string, lines: LineInput[],
) {
  const accountIds = [...new Set(lines.map(line => line.account_id))];
  const postingAccounts = await trx.selectFrom('chart_of_accounts')
    .select(['id', 'code', 'name', 'is_locked'])
    .where('business_id', '=', businessId)
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
}

export async function postJournalEntry(
  trx: Transaction<DB>, ctx: ServiceCtx, input: PostJournalEntryInput,
) {
  assertBalanced(input.lines);
  await assertPostableAccounts(trx, input.business_id, input.lines);

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
    const standaloneManual = (input.source_type === 'manual' || input.source_type === 'adjustment')
      && input.source_id == null;
    if (standaloneManual && (requestedNumber.length > 99 || requestedNumber.endsWith('R'))) {
      throw new PreconditionError(
        requestedNumber.endsWith('R')
          ? 'Journal numbers ending in R are reserved for reversal entries'
          : 'Journal numbers must be 99 characters or fewer so they can be reversed',
      );
    }
    if (/^[1-9]\d{0,17}$/.test(requestedNumber)) {
      await reserveCounterAtLeast(trx, input.business_id, 'journal_entry', requestedNumber);
    }
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
    transaction_type: input.transaction_type ?? null,
    payee_name: input.payee_name ?? null,
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

  // Default to the original entry's own date, not today -- a void always nets
  // against the transaction it is undoing, regardless of when the void is
  // clicked. Callers may still override (e.g. a source service with its own
  // date field), but the fallback itself is now always the safe one.
  const reversalDate = input.reversal_date ?? orig.entry_date;
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
    memo: `Reversal of JE ${orig.journal_number}: ${input.void_reason}`,
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
  const reversalJournalNumber = `${original.journal_number}R`;
  if (reversalJournalNumber.length > 100) {
    throw new PreconditionError('This legacy journal number is too long to create a reversal number');
  }
  const numberConflict = await trx.selectFrom('journal_entries').select('id')
    .where('business_id', '=', original.business_id)
    .where('journal_number', '=', reversalJournalNumber)
    .where('status', '<>', 'voided')
    .executeTakeFirst();
  if (numberConflict) {
    throw new BusinessRuleError(
      ERR.DUPLICATE_RESOURCE,
      `Journal number ${reversalJournalNumber} is already in use`,
    );
  }
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
    journal_number: reversalJournalNumber,
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

/**
 * Edit a posted manual journal entry in place (QBO parity).
 *
 * The row keeps its id, number, and ledger identity; only the accounting
 * content the user changed in the grid moves. History lives in the audit log
 * (before/after), not in a visible reversal pair -- an explicit reversal is
 * still available through `reverseJournalEntry`.
 */
export async function updateJournalEntry(
  trx: Transaction<DB>, ctx: ServiceCtx, input: UpdateJournalEntryInput,
) {
  if (!hasMinRole(ctx.effective_role, 'accountant')) {
    throw new BusinessRuleError(ERR.FORBIDDEN, 'Accountant access is required to edit journal entries');
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
  if (input.source_guard) {
    // The source service is editing its own entry; it must still be that
    // entry, and the edit may not re-home it to another source.
    if (
      originalBefore.source_type !== input.source_guard.source_type
      || originalBefore.source_id !== input.source_guard.source_id
      || input.replacement.source_type !== input.source_guard.source_type
    ) {
      throw new BusinessRuleError(
        ERR.IMMUTABLE_RECORD,
        'Journal entry does not belong to the source transaction requesting the edit',
      );
    }
  } else {
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
      throw new BusinessRuleError(ERR.IMMUTABLE_RECORD, 'An edited journal entry must be manual or adjusting');
    }
  }
  if (await hasPostedReversal(trx as unknown as Kysely<DB>, ctx.business_id, originalBefore.id)) {
    throw new BusinessRuleError(ERR.IMMUTABLE_RECORD, 'This journal entry has already been reversed');
  }

  const originalLines = await trx.selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', originalBefore.id)
    .orderBy('line_number')
    .execute();

  assertBalanced(input.replacement.lines);
  await assertPostableAccounts(trx, ctx.business_id, input.replacement.lines);

  // The period the entry currently sits in must be open, and so must the
  // period it is moving to -- editing into or out of a closed period is not
  // allowed without the existing firm-admin override.
  const adminOverride = (await currentSetting(trx, 'app.admin_override')) === 'on';
  const originalPeriod = await trx.selectFrom('fiscal_periods').selectAll()
    .where('id', '=', originalBefore.period_id)
    .executeTakeFirstOrThrow();
  if (originalPeriod.status === 'closed' && !adminOverride) {
    throw new ClosedPeriodError(originalPeriod.id, originalPeriod.closed_at?.toString());
  }
  const targetPeriod = await findPeriodForDate(
    trx as unknown as Kysely<DB>, ctx.business_id, input.replacement.entry_date,
  );
  if (!targetPeriod) {
    throw new PreconditionError(
      `No fiscal period covers ${input.replacement.entry_date}; create periods first`,
    );
  }
  if (targetPeriod.status === 'closed' && !adminOverride) {
    throw new ClosedPeriodError(targetPeriod.id, targetPeriod.closed_at?.toString());
  }

  const requestedNumber = input.replacement.journal_number?.trim() || null;
  let journalNumber = originalBefore.journal_number;
  if (requestedNumber && requestedNumber !== originalBefore.journal_number) {
    if (requestedNumber.length > 99 || requestedNumber.endsWith('R')) {
      throw new PreconditionError(
        requestedNumber.endsWith('R')
          ? 'Journal numbers ending in R are reserved for reversal entries'
          : 'Journal numbers must be 99 characters or fewer so they can be reversed',
      );
    }
    if (/^[1-9]\d{0,17}$/.test(requestedNumber)) {
      await reserveCounterAtLeast(trx, ctx.business_id, 'journal_entry', requestedNumber);
    }
    const duplicate = await trx.selectFrom('journal_entries').select('id')
      .where('business_id', '=', ctx.business_id)
      .where('journal_number', '=', requestedNumber)
      .where('status', '<>', 'voided')
      .where('id', '<>', originalBefore.id)
      .executeTakeFirst();
    if (duplicate) {
      throw new BusinessRuleError(
        ERR.DUPLICATE_RESOURCE,
        `Journal number ${requestedNumber} already exists`,
      );
    }
    journalNumber = requestedNumber;
  }

  // Controlled escape hatch for the posted-immutability triggers; scoped to
  // this transaction only (see 0065_journal_entry_in_place_edit.sql).
  await sql`SELECT set_config('app.allow_edit', 'on', true)`.execute(trx);

  const updated = await trx.updateTable('journal_entries')
    .set({
      entry_date: input.replacement.entry_date,
      period_id: targetPeriod.id,
      journal_number: journalNumber,
      memo: input.replacement.memo,
      reference: input.replacement.reference ?? null,
      ...(input.replacement.transaction_type !== undefined
        ? { transaction_type: input.replacement.transaction_type } : {}),
      ...(input.replacement.payee_name !== undefined
        ? { payee_name: input.replacement.payee_name } : {}),
      updated_at: sql`now()`,
    })
    .where('id', '=', originalBefore.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await trx.deleteFrom('journal_entry_lines')
    .where('journal_entry_id', '=', originalBefore.id)
    .execute();
  let n = 1;
  for (const l of input.replacement.lines) {
    await trx.insertInto('journal_entry_lines').values({
      journal_entry_id: originalBefore.id,
      line_number: n++,
      account_id: l.account_id,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo,
      name: l.name ?? null,
      class_name: l.class_name ?? null,
    }).execute();
  }

  const updatedLines = await trx.selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', originalBefore.id)
    .orderBy('line_number')
    .execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.JOURNAL_ENTRY_UPDATE,
    entity_type: 'journal_entry',
    entity_id: originalBefore.id,
    before: { entry: originalBefore, lines: originalLines },
    after: { entry: updated, lines: updatedLines },
  });

  return { entry: updated, lines: updatedLines };
}

export type JournalEntryDeletePlan = {
  /** Why this entry cannot be deleted, or null when it can. */
  block_reason: string | null;
  /** Entries a delete removes, in the order they must go (a reversal before its original). */
  entry_ids: string[];
  /** True when deleting also removes the other half of a void (the original or its reversal). */
  removes_pair: boolean;
};

type DeletableEntry = {
  id: string;
  business_id: string;
  period_id: string;
  status: 'draft' | 'posted' | 'voided';
  source_type: JournalEntrySourceType;
  source_id: string | null;
  reversed_entry_id: string | null;
};

/** True when the guard's source_type/source_id match the entry's own — the
 * owning source service is deleting its own entry, so the generic
 * "source-generated entries are protected" block does not apply to it. */
function deleteSourceGuardMatches(
  entry: { source_type: JournalEntrySourceType; source_id: string | null },
  guard: JournalEntrySourceGuard | undefined,
): boolean {
  if (!guard) return false;
  if (entry.source_type === guard.source_type && entry.source_id === guard.source_id) return true;
  return guard.allow_legacy_manual === true && entry.source_type === 'manual' && entry.source_id === null;
}

/**
 * What deleting a journal entry would remove, and whether it is allowed.
 *
 * Only entries that stand on their own can be deleted: hand-entered manual and
 * adjusting entries, and reversing entries of those. A void leaves two entries
 * that cancel out (the voided original and its reversal); those are only ever
 * deleted together, since removing one half would change the books.
 *
 * `source_guard` lets a source service (Bank Deposit, Expense, ...) delete its
 * own source-generated entry — same escape hatch voidJournalEntry already has.
 * Without it, source-generated entries are refused, same as before.
 */
export async function planJournalEntryDelete(
  db: Kysely<DB>, ctx: ServiceCtx, entry: DeletableEntry,
  opts: { allowClosedPeriods?: boolean; source_guard?: JournalEntrySourceGuard } = {},
): Promise<JournalEntryDeletePlan> {
  const blocked = (block_reason: string): JournalEntryDeletePlan => ({ block_reason, entry_ids: [], removes_pair: false });
  // Delete is a hard, unrecoverable removal (QBO parity) -- firm_admin only,
  // one level above the accountant+ bar that voiding and correcting use.
  if (!hasMinRole(ctx.effective_role, 'firm_admin')) {
    return blocked('Firm admin access is required to delete journal entries.');
  }
  const sourceMessage = 'This entry was created by a source transaction. Void or delete the source transaction instead.';

  let entries: DeletableEntry[];
  if (entry.source_type === 'reversal') {
    const original = entry.reversed_entry_id
      ? await db.selectFrom('journal_entries').selectAll()
        .where('id', '=', entry.reversed_entry_id)
        .where('business_id', '=', entry.business_id)
        .executeTakeFirst()
      : undefined;
    if (!original) return blocked('The entry this one reverses could not be found.');
    if (!deleteSourceGuardMatches(original, opts.source_guard) && await isSourceGeneratedJournalEntry(db, original)) return blocked(sourceMessage);
    // Reversal of a voided original: the pair goes together. Reversal made with
    // "Reverse" (original still posted): removing it simply undoes the reversal.
    entries = original.status === 'voided' ? [entry, original] : [entry];
  } else {
    if (!deleteSourceGuardMatches(entry, opts.source_guard) && await isSourceGeneratedJournalEntry(db, entry)) return blocked(sourceMessage);
    const reversals = await db.selectFrom('journal_entries').selectAll()
      .where('business_id', '=', entry.business_id)
      .where('reversed_entry_id', '=', entry.id)
      .execute();
    if (entry.status === 'voided') {
      entries = [...reversals, entry];
    } else if (reversals.length > 0) {
      return blocked('This journal entry has been reversed. Delete the reversing entry first.');
    } else {
      entries = [entry];
    }
  }

  const ids = entries.map(item => item.id);
  const correction = await db.selectFrom('journal_entries').select('id')
    .where('business_id', '=', entry.business_id)
    .where('corrected_from_entry_id', 'in', ids)
    .where('id', 'not in', ids)
    .executeTakeFirst();
  if (correction) return blocked('Another journal entry was created as a correction of this one.');

  if (!opts.allowClosedPeriods) {
    const closed = await db.selectFrom('fiscal_periods').select('id')
      .where('id', 'in', entries.map(item => item.period_id))
      .where('status', '=', 'closed')
      .executeTakeFirst();
    if (closed) {
      return blocked(entries.length > 1
        ? 'This journal entry or its reversal is in a closed accounting period.'
        : 'This journal entry is in a closed accounting period.');
    }
  }
  return { block_reason: null, entry_ids: ids, removes_pair: entries.length > 1 };
}

/**
 * Remove a journal entry from the books (QBO "Delete"), as opposed to voiding
 * it, which keeps the entry and adds a reversal. The removed rows are written
 * to the audit log; see planJournalEntryDelete for what qualifies.
 */
export async function deleteJournalEntry(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { journal_entry_id: string; source_guard?: JournalEntrySourceGuard },
): Promise<{ deleted_entry_ids: string[] }> {
  const entry = await trx.selectFrom('journal_entries').selectAll()
    .where('id', '=', input.journal_entry_id)
    .where('business_id', '=', ctx.business_id)
    .forUpdate()
    .executeTakeFirst();
  if (!entry) throw new BusinessRuleError(ERR.NOT_FOUND, `Journal entry ${input.journal_entry_id} not found`);

  const adminOverride = (await currentSetting(trx, 'app.admin_override')) === 'on';
  const plan = await planJournalEntryDelete(trx, ctx, entry, {
    allowClosedPeriods: adminOverride,
    ...(input.source_guard !== undefined ? { source_guard: input.source_guard } : {}),
  });
  if (plan.block_reason) {
    throw new BusinessRuleError(
      hasMinRole(ctx.effective_role, 'accountant') ? ERR.IMMUTABLE_RECORD : ERR.FORBIDDEN,
      plan.block_reason,
    );
  }

  const entries = await trx.selectFrom('journal_entries').selectAll()
    .where('id', 'in', plan.entry_ids).execute();
  const lines = await trx.selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', 'in', plan.entry_ids)
    .orderBy('journal_entry_id').orderBy('line_number')
    .execute();

  // Attached files outlive the entry as unlinked receipts.
  await trx.updateTable('receipts')
    .set({ linked_entity_type: 'unlinked', linked_entity_id: null })
    .where('linked_entity_type', '=', 'journal_entry')
    .where('linked_entity_id', 'in', plan.entry_ids)
    .execute();

  // Controlled escape hatch for the posted-immutability trigger; scoped to
  // this transaction only (see 0074_journal_entry_delete.sql).
  await sql`SELECT set_config('app.allow_delete', 'on', true)`.execute(trx);
  for (const id of plan.entry_ids) {
    await trx.deleteFrom('journal_entries')
      .where('id', '=', id)
      .where('business_id', '=', entry.business_id)
      .execute();
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.JOURNAL_ENTRY_DELETE,
    entity_type: 'journal_entry',
    entity_id: entry.id,
    before: { entries, lines },
    after: null,
  });
  return { deleted_entry_ids: plan.entry_ids };
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

// Batch variant of postJournalEntry — validates accounts and resolves periods once
// across the whole set, then inserts all JEs + lines in bulk.
// Reduces DB round-trips from ~8N to ~8 for N transactions (e.g. a bank statement).
export async function postJournalEntryBatch(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  inputs: PostJournalEntryInput[],
): Promise<{ id: string }[]> {
  if (inputs.length === 0) return [];
  for (const input of inputs) assertBalanced(input.lines);

  const business_id = inputs[0]!.business_id;

  // 1. Validate all unique accounts in one query
  const allAccountIds = [...new Set(inputs.flatMap(i => i.lines.map(l => l.account_id)))];
  const postingAccounts = await trx.selectFrom('chart_of_accounts')
    .select(['id', 'code', 'name', 'is_locked'])
    .where('business_id', '=', business_id)
    .where('id', 'in', allAccountIds)
    .where('is_active', '=', true)
    .execute();
  if (postingAccounts.length !== allAccountIds.length) {
    throw new PreconditionError('Every journal line must use an active account from this business');
  }
  const lockedAccounts = postingAccounts.filter(a => a.is_locked);
  if (lockedAccounts.length > 0) {
    throw new PreconditionError(
      `Account ${lockedAccounts[0]!.code} ${lockedAccounts[0]!.name} is locked and cannot accept new postings`,
      { accounts: lockedAccounts.map(a => a.code) },
    );
  }

  // 2. Resolve fiscal periods for all dates in one range query
  const uniqueDates = [...new Set(inputs.map(i => i.entry_date))];
  const minDate = uniqueDates.reduce((a, b) => a < b ? a : b);
  const maxDate = uniqueDates.reduce((a, b) => a > b ? a : b);
  const allPeriods = await trx.selectFrom('fiscal_periods')
    .selectAll()
    .where('business_id', '=', business_id)
    .where('starts_on', '<=', maxDate)
    .where('ends_on', '>=', minDate)
    .execute();
  const adminOverride = await currentSetting(trx, 'app.admin_override');
  const getPeriod = (date: string) => {
    const p = allPeriods.find(fp => fp.starts_on <= date && fp.ends_on >= date);
    if (!p) throw new PreconditionError(`No fiscal period covers ${date}; create periods first`);
    if (p.status === 'closed' && adminOverride !== 'on') throw new ClosedPeriodError(p.id, p.closed_at?.toString());
    return p;
  };

  // 3. Allocate N journal numbers in one atomic counter increment
  const N = inputs.length;
  const counterResult = await sql<{ last_value: string }>`
    INSERT INTO numbering_counters (business_id, entity_type, last_value)
    VALUES (${business_id}, 'journal_entry', ${N})
    ON CONFLICT (business_id, entity_type) DO UPDATE
      SET last_value = numbering_counters.last_value + ${N}
    RETURNING last_value
  `.execute(trx);
  const lastNumber = parseInt(counterResult.rows[0]!.last_value, 10);
  const firstNumber = lastNumber - N + 1;

  // 4. Batch insert all journal entries
  const createdJEs = await trx.insertInto('journal_entries')
    .values(inputs.map((input, i) => ({
      business_id,
      period_id: getPeriod(input.entry_date).id,
      entry_date: input.entry_date,
      journal_number: String(firstNumber + i),
      memo: input.memo,
      reference: input.reference ?? null,
      status: 'draft' as const,
      source_type: input.source_type,
      source_id: input.source_id ?? null,
      transaction_type: input.transaction_type ?? null,
      payee_name: input.payee_name ?? null,
      corrected_from_entry_id: input.corrected_from_entry_id ?? null,
      created_by_user_id: ctx.user_id,
    })))
    .returningAll()
    .execute();

  // 5. Batch insert all journal entry lines
  await trx.insertInto('journal_entry_lines')
    .values(createdJEs.flatMap((je, i) =>
      inputs[i]!.lines.map((l, n) => ({
        journal_entry_id: je.id,
        line_number: n + 1,
        account_id: l.account_id,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo,
        name: l.name ?? null,
        class_name: l.class_name ?? null,
      })),
    ))
    .execute();

  // 6. Mark all as posted in one update
  const jeIds = createdJEs.map(je => je.id);
  const postedJEs = await trx.updateTable('journal_entries')
    .set({ status: 'posted', posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', 'in', jeIds)
    .returningAll()
    .execute();

  // 7. Batch audit records in one insert
  await trx.insertInto('audit_logs')
    .values(postedJEs.map(je => ({
      firm_id: ctx.firm_id,
      business_id: ctx.business_id,
      user_id: ctx.user_id === '00000000-0000-0000-0000-000000000000' ? null : ctx.user_id,
      request_id: ctx.request_id,
      action: AUDIT.JOURNAL_ENTRY_POST,
      entity_type: 'journal_entry' as const,
      entity_id: je.id,
      before_state: null,
      after_state: JSON.stringify(je),
      ip_address: ctx.ip_address,
      user_agent: ctx.user_agent,
    })))
    .execute();

  // createdJEs preserves inputs' order (multi-row INSERT...RETURNING), same
  // assumption step 5 already relies on to zip entries with their lines.
  return createdJEs.map(je => ({ id: je.id }));
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
