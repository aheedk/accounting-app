import { describe, expect, it } from 'vitest';
import { recentJournalEntryDate, recentJournalEntryLabel } from './journalRecent';

describe('recent journal entry presentation', () => {
  it('shows the sequential journal number and an unambiguous US date', () => {
    expect(recentJournalEntryLabel({ journal_number: '23' })).toBe('Journal Entry No. 23');
    expect(recentJournalEntryDate('2026-07-19')).toBe('07/19/2026');
  });
});
