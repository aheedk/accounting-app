import { type Kysely, type Selectable } from 'kysely';
import { ERR, hasMinRole } from '@accounting/shared';
import type {
  DB,
  JournalEntriesTable,
  JournalEntrySourceType,
  JournalEntryStatus,
} from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { isSourceGeneratedJournalEntry } from './ledgerService.js';
import { BusinessRuleError } from '../../lib/errors.js';

export type JournalEntryLineRead = {
  id: string;
  journal_entry_id: string;
  line_number: number;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
  memo: string | null;
  name: string | null;
  class_name: string | null;
};

export type JournalEntryListItem = Selectable<JournalEntriesTable> & {
  lines: JournalEntryLineRead[];
};

export type JournalEntryListQuery = {
  status?: JournalEntryStatus;
  period_start?: string;
  period_end?: string;
  limit: number;
  offset: number;
};

export type JournalEntryDetail = {
  entry: Selectable<JournalEntriesTable> & { period_status: 'open' | 'closed' };
  lines: JournalEntryLineRead[];
  can_correct: boolean;
  correction_block_reason: string | null;
  can_reverse: boolean;
  reversal_block_reason: string | null;
};

async function readLines(db: Kysely<DB>, journalEntryIds: string[]): Promise<JournalEntryLineRead[]> {
  if (journalEntryIds.length === 0) return [];
  return db.selectFrom('journal_entry_lines as jel')
    .innerJoin('chart_of_accounts as account', 'account.id', 'jel.account_id')
    .select([
      'jel.id',
      'jel.journal_entry_id',
      'jel.line_number',
      'jel.account_id',
      'account.code as account_code',
      'account.name as account_name',
      'jel.debit',
      'jel.credit',
      'jel.memo',
      'jel.name',
      'jel.class_name',
    ])
    .where('jel.journal_entry_id', 'in', journalEntryIds)
    .orderBy('jel.journal_entry_id')
    .orderBy('jel.line_number')
    .execute();
}

export async function listJournalEntries(
  db: Kysely<DB>, ctx: ServiceCtx, query: JournalEntryListQuery,
): Promise<{ entries: JournalEntryListItem[]; limit: number; offset: number }> {
  const limit = Math.min(Math.max(query.limit, 1), 200);
  const offset = Math.max(query.offset, 0);
  let entriesQuery = db.selectFrom('journal_entries')
    .selectAll()
    .where('business_id', '=', ctx.business_id);
  if (query.status) entriesQuery = entriesQuery.where('status', '=', query.status);
  if (query.period_start) entriesQuery = entriesQuery.where('entry_date', '>=', query.period_start);
  if (query.period_end) entriesQuery = entriesQuery.where('entry_date', '<=', query.period_end);

  const entries = await entriesQuery
    .orderBy('entry_date', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();
  const lines = await readLines(db, entries.map(entry => entry.id));
  const linesByEntry = new Map<string, JournalEntryLineRead[]>();
  for (const line of lines) {
    const group = linesByEntry.get(line.journal_entry_id) ?? [];
    group.push(line);
    linesByEntry.set(line.journal_entry_id, group);
  }

  return {
    entries: entries.map(entry => ({ ...entry, lines: linesByEntry.get(entry.id) ?? [] })),
    limit,
    offset,
  };
}

function correctionBlockReason(
  effectiveRole: ServiceCtx['effective_role'],
  entry: {
    status: JournalEntryStatus;
    source_type: JournalEntrySourceType;
    source_id: string | null;
    period_status: 'open' | 'closed';
  },
  sourceGenerated: boolean,
  hasReversal: boolean,
): string | null {
  if (!hasMinRole(effectiveRole, 'accountant')) {
    return 'Accountant access is required to correct journal entries.';
  }
  if (entry.status !== 'posted') {
    return entry.status === 'voided'
      ? 'This journal entry is voided and cannot be corrected.'
      : 'Only posted journal entries can be corrected.';
  }
  if (sourceGenerated) {
    return 'This entry was created by a source transaction. Correct the source transaction instead.';
  }
  if (hasReversal) {
    return 'This journal entry has already been reversed.';
  }
  if (entry.period_status === 'closed') {
    return 'This journal entry is in a closed accounting period.';
  }
  return null;
}

function reversalBlockReason(
  effectiveRole: ServiceCtx['effective_role'],
  entry: { status: JournalEntryStatus },
  sourceGenerated: boolean,
  hasReversal: boolean,
): string | null {
  if (!hasMinRole(effectiveRole, 'accountant')) {
    return 'Accountant access is required to reverse journal entries.';
  }
  if (entry.status !== 'posted') {
    return 'Only posted journal entries can be reversed.';
  }
  if (sourceGenerated) {
    return 'This entry was created by a source transaction. Reverse the source transaction instead.';
  }
  if (hasReversal) {
    return 'This journal entry has already been reversed.';
  }
  return null;
}

export async function getJournalEntryDetail(
  db: Kysely<DB>, ctx: ServiceCtx, journalEntryId: string,
): Promise<JournalEntryDetail> {
  const entry = await db.selectFrom('journal_entries as entry')
    .innerJoin('fiscal_periods as period', 'period.id', 'entry.period_id')
    .selectAll('entry')
    .select('period.status as period_status')
    .where('entry.id', '=', journalEntryId)
    .where('entry.business_id', '=', ctx.business_id)
    .executeTakeFirst();
  if (!entry) throw new BusinessRuleError(ERR.NOT_FOUND, 'Journal entry not found');

  const lines = await readLines(db, [entry.id]);
  const sourceGenerated = await isSourceGeneratedJournalEntry(db, entry);
  const existingReversal = await db.selectFrom('journal_entries').select('id')
    .where('business_id', '=', ctx.business_id)
    .where('reversed_entry_id', '=', entry.id)
    .executeTakeFirst();
  const hasReversal = existingReversal !== undefined;
  const blockReason = correctionBlockReason(ctx.effective_role, entry, sourceGenerated, hasReversal);
  const reverseBlockReason = reversalBlockReason(
    ctx.effective_role,
    entry,
    sourceGenerated,
    hasReversal,
  );
  return {
    entry,
    lines,
    can_correct: blockReason === null,
    correction_block_reason: blockReason,
    can_reverse: reverseBlockReason === null,
    reversal_block_reason: reverseBlockReason,
  };
}
