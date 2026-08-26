import JournalNewPage from './JournalNewPage';

export const JOURNAL_NAV_ITEM = {
  path: '/journal',
  label: 'New Journal Entry',
} as const;

export function JournalLandingPage() {
  return <JournalNewPage />;
}
