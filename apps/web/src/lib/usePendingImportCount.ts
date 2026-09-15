import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';

const POLL_MS = 60_000; // refresh every minute

export function usePendingImportCount(): number {
  const [bizId] = useActiveBusinessId();
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!bizId) { setCount(0); return; }

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
  }, [bizId]);

  return count;
}
