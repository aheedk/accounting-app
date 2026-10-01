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

/**
 * The company another tab of this browser switched to, or null while this tab
 * is still in step. The active company lives in localStorage, which every tab
 * shares, so once another tab switches, this one is showing one company while
 * the browser's "current" company is another -- the cue to stop and ask
 * (QuickBooks does the same) rather than let work land in the wrong books.
 */
export function useCompanySwitchedElsewhere(): string | null {
  const [mine] = useActiveBusinessId();
  const [stored, setStored] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  // `storage` only fires in the *other* tabs, which is exactly the signal wanted.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY || e.key === null) setStored(localStorage.getItem(STORAGE_KEY));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // A switch made in this tab writes localStorage itself; stay in step with it.
  useEffect(() => { setStored(localStorage.getItem(STORAGE_KEY)); }, [mine]);

  return stored && mine && stored !== mine ? stored : null;
}
