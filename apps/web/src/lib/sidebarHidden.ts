import { useSyncExternalStore } from 'react';

// Whether the sidebar is hidden on a wide screen (item 89, as in QuickBooks).
// Kept in this browser only, like the other layout choices; a private window
// that refuses storage simply starts with it shown.
const KEY = 'sidebar_hidden';
const listeners = new Set<() => void>();

function stored(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

let hidden = stored();

export function setSidebarHidden(next: boolean): void {
  hidden = next;
  try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* storage refused: it lasts until the page reloads */ }
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSidebarHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hidden, () => false);
}
