import { Decimal } from 'decimal.js';
import { parseMoneyInput } from '@/lib/money';
import type { JournalEntryDetail } from './journalEntryTypes';

export type JournalEntryFormLine = {
  account_id: string;
  debit: string;
  credit: string;
  description: string;
  name: string;
  class_name: string;
};

export type JournalEntryFormValues = {
  date: string;
  journalNo: string;
  isAdjusting: boolean;
  memo: string;
  lines: JournalEntryFormLine[];
};

export type JournalEntryPayload = {
  entry_date: string;
  reference: string | null;
  memo: string | null;
  is_adjusting: boolean;
  lines: Array<{
    account_id: string;
    debit: string;
    credit: string;
    memo: string | null;
    name: string | null;
    class_name: string | null;
  }>;
};

const DEFAULT_ROWS = 8;

export function blankJournalLine(): JournalEntryFormLine {
  return { account_id: '', debit: '', credit: '', description: '', name: '', class_name: '' };
}

export function newJournalEntryForm(date: string): JournalEntryFormValues {
  return {
    date,
    journalNo: '',
    isAdjusting: false,
    memo: '',
    lines: Array.from({ length: DEFAULT_ROWS }, blankJournalLine),
  };
}

export function journalEntryToForm(detail: JournalEntryDetail): JournalEntryFormValues {
  const lines = detail.lines.map(line => ({
    account_id: line.account_id,
    debit: line.debit,
    credit: line.credit,
    description: line.memo ?? '',
    name: line.name ?? '',
    class_name: line.class_name ?? '',
  }));
  while (lines.length < DEFAULT_ROWS) lines.push(blankJournalLine());
  return {
    date: detail.entry.entry_date,
    journalNo: detail.entry.reference ?? '',
    isAdjusting: detail.entry.source_type === 'adjustment',
    memo: detail.entry.memo ?? '',
    lines,
  };
}

export function journalEntryPayload(form: JournalEntryFormValues): JournalEntryPayload {
  return {
    entry_date: form.date,
    reference: form.journalNo || null,
    memo: form.memo || null,
    is_adjusting: form.isAdjusting,
    lines: form.lines.filter(line => line.account_id).map(line => ({
      account_id: line.account_id,
      debit: parseMoneyInput(line.debit || '0'),
      credit: parseMoneyInput(line.credit || '0'),
      memo: line.description || null,
      name: line.name || null,
      class_name: line.class_name || null,
    })),
  };
}

export function journalEntryTotals(lines: JournalEntryFormLine[]): {
  debit: string;
  credit: string;
  balanced: boolean;
} {
  const filledLines = lines.filter(line => line.account_id);
  const debit = filledLines.reduce(
    (sum, line) => sum.plus(line.debit || 0),
    new Decimal(0),
  );
  const credit = filledLines.reduce(
    (sum, line) => sum.plus(line.credit || 0),
    new Decimal(0),
  );
  return {
    debit: debit.toFixed(4),
    credit: credit.toFixed(4),
    balanced: debit.greaterThan(0) && debit.equals(credit),
  };
}
