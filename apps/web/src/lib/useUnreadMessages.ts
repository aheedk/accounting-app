import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';

const POLL_MS = 60_000;
const READ_EVENT = 'messages-read';

/** Told by the Messages page once the thread has been read, so the badge clears at once. */
export function announceMessagesRead(): void {
  window.dispatchEvent(new Event(READ_EVENT));
}

/** How many messages on the open company's thread this person has not read. */
export function useUnreadMessages(): number {
  const [bizId] = useActiveBusinessId();
  const [state, setState] = useState<{ bizId: string; count: number } | null>(null);

  useEffect(() => {
    if (!bizId) return;
    let live = true;
    const load = () => {
      api.get<{ count: number }>(`/businesses/${bizId}/messages/unread-count`)
        .then(r => { if (live) setState({ bizId, count: r.data.count }); })
        .catch(() => undefined);   // the badge just does not show
    };
    const cleared = () => setState({ bizId, count: 0 });
    load();
    const timer = setInterval(load, POLL_MS);
    window.addEventListener(READ_EVENT, cleared);
    return () => { live = false; clearInterval(timer); window.removeEventListener(READ_EVENT, cleared); };
  }, [bizId]);

  // Another company's count is never shown while the new one loads.
  return state && state.bizId === bizId ? state.count : 0;
}
