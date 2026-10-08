import { humanizeCode } from './labels';

// What happened, from the last part of an audit action ("invoice.post").
const VERBS: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  post: 'Posted',
  void: 'Voided',
  reverse: 'Reversed',
  delete: 'Deleted',
  login: 'Signed in',
  login_failed: 'Wrong password or code',
  logout: 'Signed out',
  refresh: 'Session renewed',
  password_change: 'Changed their password',
  password_reset: 'Password reset',
  sessions_revoke: 'Signed out other browsers',
  sign_out: 'Signed out everywhere',
  two_step_enable: 'Turned on the second step',
  two_step_disable: 'Turned off the second step',
  two_step_reset: 'Second step turned off',
  deactivate: 'Switched off',
  reactivate: 'Switched back on',
  grant: 'Access given',
  revoke: 'Access taken away',
};

export function activityVerb(action: string): string {
  const verb = action.split('.').pop() ?? action;
  return VERBS[verb] ?? humanizeCode(verb);
}

// The fields that name a record, most telling first.
const NAME_FIELDS = [
  'invoice_number', 'bill_number', 'journal_number', 'check_number', 'deposit_number', 'credit_memo_number',
  'po_number', 'so_number', 'name', 'full_name', 'email', 'payee_text', 'code', 'description', 'memo',
];

/** A short name for the record a log line is about, read from what was saved. */
export function activityRecordName(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const record = state as Record<string, unknown>;
  for (const field of NAME_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) return value.length > 60 ? `${value.slice(0, 57)}…` : value;
    if (typeof value === 'number') return String(value);
  }
  return null;
}
