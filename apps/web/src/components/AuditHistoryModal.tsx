import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { humanizeCode } from '@/lib/labels';

type AuditEntry = { id: string; action: string; created_at: string; user_name: string | null; before: unknown; after: unknown };

// What happened, read from the last part of the audit action ("bank_deposit.void").
const VERB_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  post: 'Posted',
  void: 'Voided',
  reverse: 'Reversed',
  delete: 'Deleted',
};

function actionLabel(action: string): string {
  const verb = action.split('.').pop() ?? action;
  return VERB_LABELS[verb] ?? humanizeCode(verb);
}

/**
 * Who changed a record and when, newest first, read from `url` (a record's
 * `.../audit-history` endpoint). The same panel as the ones on Check and
 * Expense, which were written first and keep their own copies.
 */
export function AuditHistoryModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ history: AuditEntry[] }>(url)
      .then(r => setEntries(r.data.history))
      .catch((e: unknown) => setErr(pickErr(e)));
  }, [url]);

  return (
    // !mt-0: a parent's space-y would otherwise push the overlay down the page.
    <div className="fixed inset-0 z-50 !mt-0 flex items-start justify-center bg-black/40 pt-12">
      <div className="w-full max-w-3xl rounded-lg border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <p className="text-sm font-semibold">Audit History</p>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {err && <p className="text-sm text-destructive">{err}</p>}
          {!err && entries === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!err && entries?.length === 0 && <p className="text-sm text-muted-foreground">No history yet.</p>}
          {entries && entries.length > 0 && (
            <ul className="space-y-4">
              {entries.map(entry => (
                <li key={entry.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{actionLabel(entry.action)}</span>
                    <span className="text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{entry.user_name ?? 'System'}</p>
                  {(entry.before !== null || entry.after !== null) && (
                    <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="mb-1 font-medium text-muted-foreground">Before</p>
                        <pre className="max-h-40 overflow-auto rounded bg-muted/50 p-2">{entry.before ? JSON.stringify(entry.before, null, 2) : '—'}</pre>
                      </div>
                      <div>
                        <p className="mb-1 font-medium text-muted-foreground">After</p>
                        <pre className="max-h-40 overflow-auto rounded bg-muted/50 p-2">{entry.after ? JSON.stringify(entry.after, null, 2) : '—'}</pre>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
