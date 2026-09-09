export const JOURNAL_NAV_ITEM = {
  path: '/journal',
  label: 'New Journal Entry',
} as const;

export const JOURNAL_CLOSE_PATH = '/reports/general-ledger';

export type JournalSaveDestination = 'new' | 'close' | 'detail';

export function journalDestinationPath(
  destination: JournalSaveDestination,
  savedId: string,
): string {
  if (destination === 'new') return '/journal/new';
  if (destination === 'close') return JOURNAL_CLOSE_PATH;
  return `/journal/${savedId}`;
}
