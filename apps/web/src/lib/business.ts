import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/useAuth';

const STORAGE_KEY = 'acct_active_business';

export function useActiveBusinessId(): [string | null, (id: string) => void] {
  const { businesses } = useAuth();
  const [active, setActive] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  useEffect(() => {
    if (businesses.length === 0) { setActive(null); return; }
    if (!active || !businesses.find(b => b.id === active)) {
      const first = businesses[0]!.id;
      setActive(first);
      localStorage.setItem(STORAGE_KEY, first);
    }
  }, [businesses, active]);

  function pick(id: string) {
    setActive(id);
    localStorage.setItem(STORAGE_KEY, id);
  }
  return [active, pick];
}
