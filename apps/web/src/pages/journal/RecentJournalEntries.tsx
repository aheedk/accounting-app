import { useEffect, useRef, useState } from 'react';
import { History, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import type { JournalEntryListItem } from './journalEntryTypes';
import {
  hasMoreRecentJournalEntries,
  recentJournalEntryDate,
  recentJournalEntryLabel,
} from './journalRecent';

export default function RecentJournalEntries({ businessId }: { businessId: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<JournalEntryListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const businessIdRef = useRef(businessId);

  useEffect(() => {
    businessIdRef.current = businessId;
    setEntries([]);
    setError(null);
    setLoaded(false);
    setHasMore(true);
    setLoadingMore(false);
    setOpen(false);
  }, [businessId]);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    api.get<{ entries: JournalEntryListItem[] }>(`/businesses/${businessId}/journal-entries`, {
      params: { limit: 10, offset: 0, sort: 'recent' },
    }).then(response => {
      if (cancelled) return;
      setEntries(response.data.entries);
      setHasMore(hasMoreRecentJournalEntries(response.data.entries.length));
      setLoaded(true);
    }).catch((requestError: unknown) => {
      if (cancelled) return;
      setError(pickErr(requestError));
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [businessId, loaded, open]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    const requestedBusinessId = businessId;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await api.get<{ entries: JournalEntryListItem[] }>(
        `/businesses/${requestedBusinessId}/journal-entries`,
        { params: { limit: 10, offset: entries.length, sort: 'recent' } },
      );
      if (businessIdRef.current !== requestedBusinessId) return;
      setEntries(current => [...current, ...response.data.entries]);
      setHasMore(hasMoreRecentJournalEntries(response.data.entries.length));
    } catch (requestError: unknown) {
      if (businessIdRef.current === requestedBusinessId) setError(pickErr(requestError));
    } finally {
      if (businessIdRef.current === requestedBusinessId) setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <History className="h-5 w-5" />
        Recent journal entries
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Recent journal entries"
          className="absolute left-0 top-full z-50 mt-2 max-h-[70vh] w-[34rem] max-w-[calc(100vw-3rem)] overflow-y-auto rounded-md border bg-background p-4 shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Journal Entries</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close recent journal entries" className="rounded p-1 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
          {error && <p className="py-2 text-sm text-destructive">{error}</p>}
          {!loaded && <p className="py-2 text-sm text-muted-foreground">Loading...</p>}
          {loaded && !error && entries.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">No journal entries yet.</p>
          )}
          <div className="divide-y">
            {entries.map(entry => (
              <Link
                key={entry.id}
                to={`/journal/${entry.id}`}
                onClick={() => setOpen(false)}
                className="grid grid-cols-[1fr_auto] gap-8 px-2 py-2 text-sm text-primary hover:bg-muted/50 hover:underline"
              >
                <span>{recentJournalEntryLabel(entry)}</span>
                <span>{recentJournalEntryDate(entry.entry_date)}</span>
              </Link>
            ))}
          </div>
          {loaded && hasMore && (
            <button
              type="button"
              onClick={() => { void loadMore(); }}
              disabled={loadingMore}
              className="mt-3 text-sm font-medium text-primary hover:underline disabled:opacity-50"
            >
              {loadingMore ? 'Loading...' : 'View more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
