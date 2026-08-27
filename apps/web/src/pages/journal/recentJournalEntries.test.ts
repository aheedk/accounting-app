import { describe, expect, it } from 'vitest';
import {
  hasMoreRecentJournalEntries,
  recentJournalEntryDate,
  recentJournalEntryLabel,
} from './journalRecent';

describe('recent journal entry presentation', () => {
  it('shows the sequential journal number and an unambiguous US date', () => {
    expect(recentJournalEntryLabel({ journal_number: '23' })).toBe('Journal Entry No. 23');
    expect(recentJournalEntryDate('2026-07-19')).toBe('07/19/2026');
  });

  it('only offers an in-panel next page after a full page of results', () => {
    expect(hasMoreRecentJournalEntries(10)).toBe(true);
    expect(hasMoreRecentJournalEntries(7)).toBe(false);
  });
});
