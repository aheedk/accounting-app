import { describe, expect, it } from 'vitest';
import JournalNewPage from './JournalNewPage';
import { JournalLandingPage } from './journalLanding';
import {
  JOURNAL_CLOSE_PATH,
  JOURNAL_NAV_ITEM,
  journalDestinationPath,
} from './journalNavigation';

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

  it('closes the editor to the General Ledger instead of reopening the same form', () => {
    expect(JOURNAL_CLOSE_PATH).toBe('/reports/general-ledger');
    expect(journalDestinationPath('close', 'saved-id')).toBe('/reports/general-ledger');
    expect(journalDestinationPath('detail', 'saved-id')).toBe('/journal/saved-id');
    expect(journalDestinationPath('new', 'saved-id')).toBe('/journal/new');
  });
});
