import { describe, expect, it } from 'vitest';
import { journalEntryCreateSchema } from './journalEntry.js';

describe('journalEntryCreateSchema', () => {
  it('preserves the adjusting flag and optional line Name and Class', () => {
    const parsed = journalEntryCreateSchema.parse({
      entry_date: '2026-08-25',
      journal_number: 'AJE-25',
      is_adjusting: true,
      lines: [
        {
          account_id: '11111111-1111-4111-8111-111111111111',
          debit: '25.0000',
          credit: '0',
          name: 'Patient A',
          class_name: 'Clinic',
        },
        {
          account_id: '22222222-2222-4222-8222-222222222222',
          debit: '0',
          credit: '25.0000',
        },
      ],
    });

    const result = parsed as typeof parsed & { is_adjusting?: boolean };
    const firstLine = parsed.lines[0] as typeof parsed.lines[number] & {
      name?: string;
      class_name?: string;
    };
    expect(result.is_adjusting).toBe(true);
    expect(result.journal_number).toBe('AJE-25');
    expect(firstLine).toMatchObject({ name: 'Patient A', class_name: 'Clinic' });
  });
});
