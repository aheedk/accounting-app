import { useCallback } from 'react';
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
