import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useEffectiveRole } from '@/lib/roleAccess';

const POLL_MS = 60_000; // refresh every minute

export function usePendingImportCount(): number {
  const [bizId] = useActiveBusinessId();
  // A client login has no AI inbox, so there is nothing to count or to ask for.
  const role = useEffectiveRole();
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!bizId || role === null || role === 'client') { setCount(0); return; }

    let cancelled = false;
    async function fetch() {
      try {
        const r = await api.get<{ count: number }>(`/businesses/${bizId}/email-imports/pending-count`);
        if (!cancelled) setCount(r.data.count);
      } catch {
        // silently ignore — badge just won't show
      }
    }

    void fetch();
    timer.current = setInterval(() => void fetch(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer.current);
    };
  }, [bizId, role]);

  return count;
}
