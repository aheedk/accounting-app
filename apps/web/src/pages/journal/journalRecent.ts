export function recentJournalEntryLabel(entry: { journal_number: string }): string {
  return `Journal Entry No. ${entry.journal_number}`;
}

export function recentJournalEntryDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[2]}/${match[3]}/${match[1]}`;
}
