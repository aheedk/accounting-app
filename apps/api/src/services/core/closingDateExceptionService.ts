import { type Kysely } from 'kysely';
import { toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { describeTransactions, type TransactionEntry } from './transactionDescriptorService.js';

// QuickBooks' Closing Date Exception Report: what changed in a period after
// it closed. This app has no in-place editing of a posted entry to catch —
// "Posted documents are corrected, not rewritten" (CLAUDE.md): a correction
// voids the original and posts a new one — so there are exactly two ways a
// closed period's own numbers can move after close, both only reachable
// through a firm admin's closed-period override (adminOverrideService.ts):
// an entry posted into the period after it closed, or one that was there
// already and got voided after close. `journal_entries.period_id` is the
// entry's own period at post time, so no date-range guess is needed.

export type ClosingDateExceptionReason = 'posted_after_close' | 'voided_after_close';

export type ClosingDateException = {
  journal_entry_id: string;
  entry_date: string;
  label: string;
  num: string | null;
  name: string | null;
  memo: string | null;
  path: string | null;
  /** Total debits (= total credits) of the entry. */
  amount: string;
  reason: ClosingDateExceptionReason;
  /** When the exception happened — created_at or voided_at, whichever applies. */
  when: string;
  who: string | null;
  period_starts_on: string;
  period_ends_on: string;
  closed_at: string;
};

export async function closingDateExceptions(db: Kysely<DB>, business_id: string): Promise<ClosingDateException[]> {
  const rows = await db.selectFrom('journal_entries as je')
    .innerJoin('fiscal_periods as fp', 'fp.id', 'je.period_id')
    .leftJoin('users as creator', 'creator.id', 'je.created_by_user_id')
    .leftJoin('users as voider', 'voider.id', 'je.voided_by_user_id')
    .select([
      'je.id', 'je.entry_date', 'je.journal_number', 'je.memo', 'je.reference',
      'je.source_type', 'je.source_id', 'je.transaction_type', 'je.payee_name',
      'je.created_at', 'je.voided_at',
      'creator.full_name as created_by_name', 'voider.full_name as voided_by_name',
      'fp.starts_on', 'fp.ends_on', 'fp.closed_at',
    ])
    .where('fp.business_id', '=', business_id)
    .where('fp.status', '=', 'closed')
    .where(eb => eb.or([
      eb(eb.ref('je.created_at'), '>', eb.ref('fp.closed_at')),
      eb.and([eb('je.voided_at', 'is not', null), eb(eb.ref('je.voided_at'), '>', eb.ref('fp.closed_at'))]),
    ]))
    .orderBy('je.entry_date', 'desc')
    .execute();
  if (rows.length === 0) return [];

  const entries: TransactionEntry[] = rows.map(r => ({
    id: r.id, source_type: r.source_type, source_id: r.source_id,
    transaction_type: r.transaction_type, payee_name: r.payee_name, reference: r.reference,
    journal_number: r.journal_number,
  }));
  const descriptors = await describeTransactions(db, entries);

  const sums = await db.selectFrom('journal_entry_lines')
    .select(({ fn }) => ['journal_entry_id', fn.sum<string>('debit').as('total_debit')])
    .where('journal_entry_id', 'in', rows.map(r => r.id))
    .groupBy('journal_entry_id')
    .execute();
  const amountByEntry = new Map(sums.map(s => [s.journal_entry_id, toMoneyString(s.total_debit)]));

  // Timestamp columns come back as Date objects (or sometimes strings,
  // depending on the driver's type parsers) — compare them as real instants,
  // never as strings: String(aDate) isn't in a lexically-sortable format.
  const toMs = (v: unknown): number => new Date(v as string | Date).getTime();

  return rows.map(r => {
    const d = descriptors.get(r.id);
    const closedAtMs = toMs(r.closed_at);
    const postedAfterClose = toMs(r.created_at) > closedAtMs;
    const reason: ClosingDateExceptionReason = postedAfterClose ? 'posted_after_close' : 'voided_after_close';
    return {
      journal_entry_id: r.id,
      entry_date: String(r.entry_date).slice(0, 10),
      label: d?.label ?? 'Journal Entry',
      num: d?.num ?? r.journal_number,
      name: d?.name ?? r.payee_name,
      memo: d?.memo ?? r.memo,
      path: d?.path ?? `/accounting/journal-entries/${r.id}`,
      amount: amountByEntry.get(r.id) ?? '0.0000',
      reason,
      when: new Date(postedAfterClose ? toMs(r.created_at) : toMs(r.voided_at)).toISOString(),
      who: (postedAfterClose ? r.created_by_name : r.voided_by_name) ?? null,
      period_starts_on: String(r.starts_on).slice(0, 10),
      period_ends_on: String(r.ends_on).slice(0, 10),
      closed_at: new Date(closedAtMs).toISOString(),
    };
  });
}
