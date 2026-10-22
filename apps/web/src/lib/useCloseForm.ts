import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Close an entry screen (a check, an expense, a deposit, a journal entry): go
 * back to the page it was opened from, with that page's filters as they were.
 * Opened straight from a link or a new tab there is nothing to go back to, so
 * it goes to `fallback`, the list the record belongs to.
 */
export function useCloseForm(fallback: string): () => void {
  const navigate = useNavigate();
  const { key } = useLocation();
  return useCallback(() => {
    // 'default' is the key of the first page opened in this tab.
    if (key !== 'default') navigate(-1);
    else navigate(fallback);
  }, [navigate, key, fallback]);
}

// Something open on top of the screen: a list, a menu, a dialog. Escape closes
// that first. `data-disclosure` marks a section that stays expanded (the sidebar's).
const POPUP_SELECTOR = [
  '[aria-expanded="true"]:not([data-disclosure])',
  '[role="listbox"]', '[role="menu"]', '[role="dialog"]', '[role="alertdialog"]',
].join(',');

/**
 * Escape closes the entry screen, as the X does (item 86) — unless it was
 * closing a list, menu or dialog. That is judged before any of them sees the
 * key, as some close without marking it handled.
 */
export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    let popupWasOpen = false;
    const before = (e: KeyboardEvent) => {
      if (e.key === 'Escape') popupWasOpen = document.querySelector(POPUP_SELECTOR) !== null;
    };
    const after = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat || e.defaultPrevented || popupWasOpen) return;
      onClose();
    };
    window.addEventListener('keydown', before, true);
    window.addEventListener('keydown', after);
    return () => {
      window.removeEventListener('keydown', before, true);
      window.removeEventListener('keydown', after);
    };
  }, [onClose]);
}
