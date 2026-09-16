import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/useAuth';

const STORAGE_KEY = 'acct_active_business';
const BIZ_CHANGE_EVENT = 'acct_business_change';

export function useActiveBusinessId(): [string | null, (id: string) => void] {
  const { businesses } = useAuth();
  const [active, setActive] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  // Listen for business switches made by any other component using this hook
  useEffect(() => {
    function onSwitch(e: Event) {
      setActive((e as CustomEvent<string>).detail);
    }
    window.addEventListener(BIZ_CHANGE_EVENT, onSwitch);
    return () => window.removeEventListener(BIZ_CHANGE_EVENT, onSwitch);
  }, []);

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
    window.dispatchEvent(new CustomEvent(BIZ_CHANGE_EVENT, { detail: id }));
  }
  return [active, pick];
}
