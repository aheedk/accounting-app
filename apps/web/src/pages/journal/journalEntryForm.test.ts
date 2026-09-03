import { describe, expect, it } from 'vitest';
import {
  applyJournalNumberSuggestion,
  copyJournalEntryToForm,
  copyUnsavedJournalEntry,
  journalEntryPayload,
  journalSupportsManualActions,
  journalEntryToForm,
  journalEntryTotals,
  journalAccountsForLine,
  newJournalEntryForm,
} from './journalEntryForm';
import type { JournalEntryDetail } from './journalEntryTypes';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const REVENUE_ID = '22222222-2222-4222-8222-222222222222';

const detail: JournalEntryDetail = {
  entry: {
    id: '33333333-3333-4333-8333-333333333333',
    business_id: '44444444-4444-4444-8444-444444444444',
    period_id: '55555555-5555-4555-8555-555555555555',
    period_status: 'open',
    entry_date: '2026-08-20',
    memo: 'Adjustment',
    reference: 'JE-22',
    journal_number: '23',
    status: 'posted',
    source_type: 'adjustment',
    source_id: null,
    reversed_entry_id: null,
    corrected_from_entry_id: null,
    posted_at: '2026-08-20T14:00:00.000Z',
    posted_by_user_id: '66666666-6666-4666-8666-666666666666',
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    created_at: '2026-08-20T14:00:00.000Z',
    created_by_user_id: '66666666-6666-4666-8666-666666666666',
    updated_at: '2026-08-20T14:00:00.000Z',
  },
  lines: [
    {
      id: '77777777-7777-4777-8777-777777777777',
      journal_entry_id: '33333333-3333-4333-8333-333333333333',
      line_number: 1,
      account_id: CASH_ID,
      account_code: '1010',
      account_name: 'Cash',
      debit: '50.0000',
      credit: '0.0000',
      memo: 'Debit line',
      name: 'Patient A',
      class_name: 'Clinic',
    },
    {
      id: '88888888-8888-4888-8888-888888888888',
      journal_entry_id: '33333333-3333-4333-8333-333333333333',
      line_number: 2,
      account_id: REVENUE_ID,
      account_code: '4010',
      account_name: 'Sales',
      debit: '0.0000',
      credit: '50.0000',
      memo: 'Credit line',
      name: null,
      class_name: null,
    },
  ],
  can_correct: true,
  correction_block_reason: null,
  can_reverse: true,
  reversal_block_reason: null,
  is_standalone_manual: true,
};

describe('journal entry form mappings', () => {
  it('maps API detail into the shared editor and pads to eight rows', () => {
    const form = journalEntryToForm(detail);

    expect(form).toMatchObject({
      date: '2026-08-20',
      journalNo: '23',
      reference: 'JE-22',
      isAdjusting: true,
      memo: 'Adjustment',
    });
    expect(form.lines).toHaveLength(8);
    expect(form.lines[0]).toMatchObject({
      account_id: CASH_ID,
      debit: '50.0000',
      credit: '0.0000',
      description: 'Debit line',
      name: 'Patient A',
      class_name: 'Clinic',
    });
    expect(form.lines[7]).toEqual({
      account_id: '', debit: '', credit: '', description: '', name: '', class_name: '',
    });
  });

  it('serializes only account rows with exact four-decimal money strings', () => {
    const form = journalEntryToForm(detail);
    form.lines[0]!.debit = '50';
    form.lines[1]!.credit = '50.0';

    expect(journalEntryPayload(form)).toEqual({
      entry_date: '2026-08-20',
      journal_number: '23',
      reference: 'JE-22',
      memo: 'Adjustment',
      is_adjusting: true,
      lines: [
        {
          account_id: CASH_ID,
          debit: '50.0000',
          credit: '0.0000',
          memo: 'Debit line',
          name: 'Patient A',
          class_name: 'Clinic',
        },
        {
          account_id: REVENUE_ID,
          debit: '0.0000',
          credit: '50.0000',
          memo: 'Credit line',
          name: null,
          class_name: null,
        },
      ],
    });
  });

  it('lets the server assign an automatic number without losing the displayed suggestion', () => {
    const form = journalEntryToForm(detail);

    expect(journalEntryPayload(form, { automaticNumber: true }).journal_number).toBeNull();
    expect(form.journalNo).toBe('23');
  });

  it('copies the entry details under a supplied new journal number', () => {
    const copy = copyJournalEntryToForm(detail, '24');

    expect(copy).toMatchObject({
      date: '2026-08-20',
      journalNo: '24',
      reference: 'JE-22',
      memo: 'Adjustment',
      isAdjusting: true,
    });
    expect(copy.lines[0]).toMatchObject({
      account_id: CASH_ID,
      debit: '50.0000',
      description: 'Debit line',
      name: 'Patient A',
      class_name: 'Clinic',
    });
  });

  it('duplicates an unsaved entry while returning its number to automatic assignment', () => {
    const source = journalEntryToForm(detail);
    const copy = copyUnsavedJournalEntry(source);

    expect(copy).toEqual({ ...source, journalNo: '' });
    expect(copy).not.toBe(source);
    expect(copy.lines).not.toBe(source.lines);
    expect(copy.lines[0]).not.toBe(source.lines[0]);
  });

  it('computes exact balanced totals without floating-point equality', () => {
    expect(journalEntryTotals(detail.lines.map(line => ({
      account_id: line.account_id,
      debit: line.debit,
      credit: line.credit,
      description: line.memo ?? '',
      name: line.name ?? '',
      class_name: line.class_name ?? '',
    })))).toEqual({ debit: '50.0000', credit: '50.0000', balanced: true });
  });

  it('creates a blank eight-row form for the supplied local date', () => {
    const form = newJournalEntryForm('2026-08-25');
    expect(form.date).toBe('2026-08-25');
    expect(form.isAdjusting).toBe(false);
    expect(form.lines).toHaveLength(8);
  });

  it('does not overwrite a journal number the user entered while a suggestion was loading', () => {
    const blank = newJournalEntryForm('2026-08-26');
    expect(applyJournalNumberSuggestion(blank, '81', false).journalNo).toBe('81');

    const manuallyNumbered = { ...blank, journalNo: 'AJE-81' };
    expect(applyJournalNumberSuggestion(manuallyNumbered, '81', true)).toBe(manuallyNumbered);
  });

  it('uses the API-derived standalone status for copy and recurring actions', () => {
    expect(journalSupportsManualActions()).toBe(true);
    expect(journalSupportsManualActions(detail)).toBe(true);
    expect(journalSupportsManualActions({ ...detail, is_standalone_manual: false })).toBe(false);
  });

  it('offers active unlocked accounts while preserving a historical selected account', () => {
    const accounts = [
      { id: 'active', code: '1000', name: 'Active', account_type: 'asset', is_active: true, is_locked: false },
      { id: 'inactive', code: '1001', name: 'Inactive', account_type: 'asset', is_active: false, is_locked: false },
      { id: 'locked', code: '1002', name: 'Locked', account_type: 'asset', is_active: true, is_locked: true },
    ];

    expect(journalAccountsForLine(accounts, '').map(account => account.id)).toEqual(['active']);
    expect(journalAccountsForLine(accounts, 'inactive').map(account => account.id)).toEqual([
      'active',
      'inactive',
    ]);
  });
});
