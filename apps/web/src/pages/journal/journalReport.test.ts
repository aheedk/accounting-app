import { describe, expect, it } from 'vitest';
import {
  filterJournalEntries,
  journalExportRows,
  journalPeriodParams,
} from './journalReport';
import type { JournalEntryLine, JournalEntryListItem } from './journalEntryTypes';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';

function line(overrides: Partial<JournalEntryLine> & Pick<JournalEntryLine, 'id' | 'journal_entry_id' | 'line_number'>): JournalEntryLine {
  return {
    account_id: '22222222-2222-4222-8222-222222222222',
    account_code: '1010',
    account_name: 'Cash',
    debit: '0.0000',
    credit: '0.0000',
    memo: null,
    name: null,
    class_name: null,
    ...overrides,
  };
}

function entry(overrides: Pick<JournalEntryListItem, 'id' | 'entry_date' | 'reference' | 'memo' | 'lines'>): JournalEntryListItem {
  return {
    business_id: BUSINESS_ID,
    period_id: '33333333-3333-4333-8333-333333333333',
    status: 'posted',
    source_type: 'manual',
    source_id: null,
    reversed_entry_id: null,
    corrected_from_entry_id: null,
    posted_at: '2026-08-20T14:00:00.000Z',
    posted_by_user_id: '44444444-4444-4444-8444-444444444444',
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    created_at: '2026-08-20T14:00:00.000Z',
    created_by_user_id: '44444444-4444-4444-8444-444444444444',
    updated_at: '2026-08-20T14:00:00.000Z',
    ...overrides,
  };
}

const entries: JournalEntryListItem[] = [
  entry({
    id: '55555555-5555-4555-8555-555555555555',
    entry_date: '2026-08-12',
    reference: 'JE-100',
    memo: 'Patient payment',
    lines: [
      line({
        id: '66666666-6666-4666-8666-666666666666',
        journal_entry_id: '55555555-5555-4555-8555-555555555555',
        line_number: 1,
        debit: '100.0000',
        memo: 'Deposit',
        name: 'Patient A',
      }),
      line({
        id: '77777777-7777-4777-8777-777777777777',
        journal_entry_id: '55555555-5555-4555-8555-555555555555',
        line_number: 2,
        account_id: '88888888-8888-4888-8888-888888888888',
        account_code: '4010',
        account_name: 'Service Revenue',
        credit: '100.0000',
        memo: 'Treatment revenue',
      }),
    ],
  }),
  entry({
    id: '99999999-9999-4999-8999-999999999999',
    entry_date: '2026-08-18',
    reference: 'AJE-22',
    memo: 'Supply adjustment',
    lines: [
      line({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        journal_entry_id: '99999999-9999-4999-8999-999999999999',
        line_number: 1,
        account_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        account_code: '5100',
        account_name: 'Dental Supplies',
        debit: '50.0000',
        class_name: 'Clinic',
      }),
      line({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        journal_entry_id: '99999999-9999-4999-8999-999999999999',
        line_number: 2,
        account_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        account_code: '2010',
        account_name: 'Accounts Payable',
        credit: '50.0000',
      }),
    ],
  }),
];

describe('journal report helpers', () => {
  it('creates local month, year, custom, and all-date API parameters', () => {
    const today = new Date(2026, 7, 25, 12, 0, 0);
    expect(journalPeriodParams('month', today, '', '')).toEqual({
      period_start: '2026-08-01',
      period_end: '2026-08-31',
    });
    expect(journalPeriodParams('year', today, '', '')).toEqual({
      period_start: '2026-01-01',
      period_end: '2026-12-31',
    });
    expect(journalPeriodParams('custom', today, '2026-02-01', '2026-02-28')).toEqual({
      period_start: '2026-02-01',
      period_end: '2026-02-28',
    });
    expect(journalPeriodParams('all', today, '', '')).toEqual({});
  });

  it('searches parent and line values while preserving each matching entry group', () => {
    expect(filterJournalEntries(entries, 'all', 'JE-100').map(item => item.id)).toEqual([entries[0]!.id]);
    expect(filterJournalEntries(entries, 'all', 'Patient A').map(item => item.id)).toEqual([entries[0]!.id]);
    expect(filterJournalEntries(entries, 'all', 'Dental Supplies').map(item => item.id)).toEqual([entries[1]!.id]);
    expect(filterJournalEntries(entries, 'all', '50.0000').map(item => item.id)).toEqual([entries[1]!.id]);
    expect(filterJournalEntries(entries, 'voided', '').map(item => item.id)).toEqual([]);
  });

  it('exports every line plus entry totals and an exact report total', () => {
    const result = journalExportRows(entries);

    expect(result.rows).toHaveLength(7);
    expect(result.rows[0]).toEqual([
      '8/12/26', 'Manual', 'JE-100', 'Patient A', 'Deposit', '1010', 'Cash', '100.0000', '',
    ]);
    expect(result.rows[2]).toEqual(['', '', '', '', 'Total for JE-100', '', '', '100.0000', '100.0000']);
    expect(result.rows[6]).toEqual(['', '', '', '', 'REPORT TOTAL', '', '', '150.0000', '150.0000']);
    expect(result.totals).toEqual({ debit: '150.0000', credit: '150.0000' });
  });
});
