import { journalEntryPayload, type JournalEntryFormValues } from './journalEntryForm';

export type JournalRecurrence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type JournalRecurringSchedule = {
  name: string;
  recurrence: JournalRecurrence;
  nextRunDate: string;
  endDate: string;
};

export function journalRecurringTemplateRequest(
  form: JournalEntryFormValues,
  schedule: JournalRecurringSchedule,
) {
  const entry = journalEntryPayload(form);
  return {
    name: schedule.name.trim(),
    template_type: 'journal_entry' as const,
    recurrence: schedule.recurrence,
    next_run_date: schedule.nextRunDate,
    end_date: schedule.endDate || null,
    payload: {
      memo: entry.memo,
      reference: entry.reference,
      is_adjusting: entry.is_adjusting,
      lines: entry.lines,
    },
  };
}
