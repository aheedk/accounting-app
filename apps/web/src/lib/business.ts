import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/useAuth';

// Each tab has its own company open (sessionStorage), so a firm can work on two
// clients side by side. Every API path names the company, so nothing depends on
// a browser-wide "current" one. localStorage keeps the company last open in the
// browser: a new tab, which starts with no company of its own, opens on it.
// (Until 10-26 the company was one per browser and other tabs were shut on a
// switch, as QuickBooks does; that stopped Faizan working in tabs.)
const STORAGE_KEY = 'acct_active_business';
const BIZ_CHANGE_EVENT = 'acct_business_change';

/** This tab's company. A tab's first read takes the browser's last one and keeps it. */
function readTabCompany(): string | null {
  const mine = sessionStorage.getItem(STORAGE_KEY);
  if (mine) return mine;
  const last = localStorage.getItem(STORAGE_KEY);
  if (last) sessionStorage.setItem(STORAGE_KEY, last);
  return last;
}

function saveCompany(id: string) {
  sessionStorage.setItem(STORAGE_KEY, id);
  localStorage.setItem(STORAGE_KEY, id);
}

export function useActiveBusinessId(): [string | null, (id: string) => void] {
  const { businesses } = useAuth();
  const [active, setActive] = useState<string | null>(readTabCompany);

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
      saveCompany(first);
    }
  }, [businesses, active]);

  function pick(id: string) {
    setActive(id);
    saveCompany(id);
    window.dispatchEvent(new CustomEvent(BIZ_CHANGE_EVENT, { detail: id }));
  }
  return [active, pick];
}

/**
 * While this tab is in front, it is the company a new tab opens on, so an
 * entry opened in a new tab (Ctrl+click on + New, Add new item) is for the
 * client it was opened from, not one last picked in some other tab.
 */
export function useNewTabsStartHere(): void {
  const [active] = useActiveBusinessId();
  useEffect(() => {
    if (!active) return;
    const mark = () => {
      if (document.visibilityState === 'visible') localStorage.setItem(STORAGE_KEY, active);
    };
    if (document.hasFocus()) mark();
    window.addEventListener('focus', mark);
    document.addEventListener('visibilitychange', mark);
    return () => {
      window.removeEventListener('focus', mark);
      document.removeEventListener('visibilitychange', mark);
    };
  }, [active]);
}
