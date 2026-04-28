import { type Kysely } from 'kysely';
import type { DB } from '../../db/types.js';
import * as ledger from '../core/ledgerService.js';

export type CsvFile = { filename: string; content_type: string; body: Buffer };

export function rowsToCsv(
  rows: Array<Record<string, string | number | null>>,
  columns: string[],
): string {
  const escape = (v: string | number | null): string => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.join(',');
  const body = rows.map(r => columns.map(c => escape(r[c] ?? null)).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

export async function exportTrialBalance(
  db: Kysely<DB>,
  business_id: string,
  asOfDate: string,
): Promise<CsvFile> {
  const tb = await ledger.computeTrialBalance(db, { business_id, as_of: asOfDate });
  const csv = rowsToCsv(
    tb.rows.map(r => ({
      code: r.code,
      name: r.name,
      account_type: r.account_type,
      total_debit: r.total_debit,
      total_credit: r.total_credit,
      net: r.net,
    })),
    ['code', 'name', 'account_type', 'total_debit', 'total_credit', 'net'],
  );
  return {
    filename: `trial-balance-${asOfDate}.csv`,
    content_type: 'text/csv',
    body: Buffer.from(csv, 'utf-8'),
  };
}

export async function exportJournalEntryLines(
  db: Kysely<DB>,
  business_id: string,
  from: string,
  to: string,
): Promise<CsvFile> {
  const rows = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .innerJoin('chart_of_accounts as coa', 'coa.id', 'jel.account_id')
    .select([
      'je.entry_date',
      'je.memo as je_memo',
      'coa.code as account_code',
      'coa.name as account_name',
      'jel.debit',
      'jel.credit',
      'jel.memo as line_memo',
    ])
    .where('je.business_id', '=', business_id)
    .where('je.status', '=', 'posted')
    .where('je.entry_date', '>=', from)
    .where('je.entry_date', '<=', to)
    .orderBy('je.entry_date')
    .orderBy('coa.code')
    .execute();

  const csv = rowsToCsv(
    rows.map(r => ({
      entry_date: r.entry_date,
      account_code: r.account_code,
      account_name: r.account_name,
      debit: r.debit,
      credit: r.credit,
      memo: r.line_memo ?? r.je_memo ?? '',
    })),
    ['entry_date', 'account_code', 'account_name', 'debit', 'credit', 'memo'],
  );
  return {
    filename: `journal-entries-${from}-to-${to}.csv`,
    content_type: 'text/csv',
    body: Buffer.from(csv, 'utf-8'),
  };
}
