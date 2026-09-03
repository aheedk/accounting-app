import { describe, expect, it } from 'vitest';
import { journalRecurringTemplateRequest } from './journalRecurring';
import type { JournalEntryFormValues } from './journalEntryForm';

const form: JournalEntryFormValues = {
  date: '2026-08-26',
  journalNo: '23',
  reference: 'MONTH-END',
  isAdjusting: true,
  memo: 'Monthly accrual',
  lines: [
    {
      account_id: '11111111-1111-4111-8111-111111111111',
      debit: '100', credit: '', description: 'Accrue expense', name: 'Clinic', class_name: 'Dental',
    },
    {
      account_id: '22222222-2222-4222-8222-222222222222',
      debit: '', credit: '100', description: '', name: '', class_name: '',
    },
  ],
};

describe('journal recurring template request', () => {
  it('keeps journal details but leaves each run to assign its own number and date', () => {
    expect(journalRecurringTemplateRequest(form, {
      name: 'Monthly accrual',
      recurrence: 'monthly',
      nextRunDate: '2026-09-01',
      endDate: '',
    })).toEqual({
      name: 'Monthly accrual',
      template_type: 'journal_entry',
      recurrence: 'monthly',
      next_run_date: '2026-09-01',
      end_date: null,
      payload: {
        memo: 'Monthly accrual',
        reference: 'MONTH-END',
        is_adjusting: true,
        lines: [
          {
            account_id: '11111111-1111-4111-8111-111111111111',
            debit: '100.0000', credit: '0.0000', memo: 'Accrue expense', name: 'Clinic', class_name: 'Dental',
          },
          {
            account_id: '22222222-2222-4222-8222-222222222222',
            debit: '0.0000', credit: '100.0000', memo: null, name: null, class_name: null,
          },
        ],
      },
    });
  });
});
