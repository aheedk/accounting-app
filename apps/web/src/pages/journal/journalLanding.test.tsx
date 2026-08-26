import { describe, expect, it } from 'vitest';
import JournalNewPage from './JournalNewPage';
import { JOURNAL_NAV_ITEM, JournalLandingPage } from './journalLanding';

describe('journal landing', () => {
  it('opens the new journal entry editor instead of a duplicate report', () => {
    const page = JournalLandingPage();

    expect(page.type).toBe(JournalNewPage);
  });

  it('labels the accounting destination as New Journal Entry', () => {
    expect(JOURNAL_NAV_ITEM).toEqual({
      path: '/journal',
      label: 'New Journal Entry',
    });
  });
});
