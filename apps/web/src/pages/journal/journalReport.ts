import { Decimal } from 'decimal.js';
import { dateToLocalIso } from '@/lib/dates';
import type { JournalEntryListItem, JournalEntrySourceType } from './journalEntryTypes';

export type JournalPeriodPreset = 'all' | 'month' | 'year' | 'custom';

export const JOURNAL_HEADERS = [
  'Transaction date',
  'Transaction type',
  'Num',
  'Name',
  'Description',
  'Account number',
  'Account name',
  'Debit',
  'Credit',
];

export function formatJournalDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${Number(month)}/${Number(day)}/${year.slice(2)}`;
}

export function formatJournalSource(source: JournalEntrySourceType): string {
  return source
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function journalPeriodParams(
  preset: JournalPeriodPreset,
  today: Date,
  customStart: string,
  customEnd: string,
): { period_start?: string; period_end?: string } {
  if (preset === 'all') return {};
  if (preset === 'custom') {
    return {
      ...(customStart ? { period_start: customStart } : {}),
      ...(customEnd ? { period_end: customEnd } : {}),
    };
  }

  if (preset === 'year') {
    return {
      period_start: dateToLocalIso(new Date(today.getFullYear(), 0, 1)),
      period_end: dateToLocalIso(new Date(today.getFullYear(), 11, 31)),
    };
  }

  return {
    period_start: dateToLocalIso(new Date(today.getFullYear(), today.getMonth(), 1)),
    period_end: dateToLocalIso(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
}

export function filterJournalEntries(
  entries: JournalEntryListItem[],
  status: string,
  search: string,
): JournalEntryListItem[] {
  const query = search.trim().toLowerCase();

  return entries.filter(entry => {
    if (status !== 'all' && entry.status !== status) return false;
    if (!query) return true;

    const parentValues = [
      entry.entry_date,
      formatJournalDate(entry.entry_date),
      entry.reference,
      entry.memo,
      entry.status,
      entry.source_type,
      formatJournalSource(entry.source_type),
    ];
    const lineValues = entry.lines.flatMap(line => [
      line.name,
      line.memo,
      line.class_name,
      line.account_code,
      line.account_name,
      line.debit,
      line.credit,
    ]);

    return [...parentValues, ...lineValues].some(value =>
      String(value ?? '').toLowerCase().includes(query),
    );
  });
}

export function journalExportRows(entries: JournalEntryListItem[]): {
  rows: string[][];
  totals: { debit: string; credit: string };
} {
  const rows: string[][] = [];
  let reportDebit = new Decimal(0);
  let reportCredit = new Decimal(0);

  for (const entry of entries) {
    let entryDebit = new Decimal(0);
    let entryCredit = new Decimal(0);

    for (const line of entry.lines) {
      const debit = new Decimal(line.debit || 0);
      const credit = new Decimal(line.credit || 0);
      entryDebit = entryDebit.plus(debit);
      entryCredit = entryCredit.plus(credit);
      reportDebit = reportDebit.plus(debit);
      reportCredit = reportCredit.plus(credit);

      rows.push([
        formatJournalDate(entry.entry_date),
        formatJournalSource(entry.source_type),
        entry.reference ?? '',
        line.name ?? '',
        line.memo ?? entry.memo ?? '',
        line.account_code,
        line.account_name,
        debit.isZero() ? '' : debit.toFixed(4),
        credit.isZero() ? '' : credit.toFixed(4),
      ]);
    }

    rows.push([
      '', '', '', '', `Total for ${entry.reference || formatJournalSource(entry.source_type)}`, '', '',
      entryDebit.toFixed(4), entryCredit.toFixed(4),
    ]);
  }

  const totals = {
    debit: reportDebit.toFixed(4),
    credit: reportCredit.toFixed(4),
  };
  rows.push(['', '', '', '', 'REPORT TOTAL', '', '', totals.debit, totals.credit]);

  return { rows, totals };
}
