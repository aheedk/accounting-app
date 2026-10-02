import { useEffect, type RefObject } from 'react';

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]), button:not([disabled]), a[href]';

/**
 * Up / Down / Home / End move between the items of an open popup menu, the way
 * a native menu behaves. Down from the trigger enters the menu at the top, Up
 * at the bottom. Typing in a text field inside the menu is left alone.
 */
export function useArrowKeyMenu(open: boolean, menuRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const menu = menuRef.current;
      if (!menu) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return;
      const items = Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
      if (items.length === 0) return;
      const current = focused instanceof HTMLElement ? items.indexOf(focused) : -1;
      let next: number;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      else if (e.key === 'ArrowDown') next = current < 0 ? 0 : Math.min(current + 1, items.length - 1);
      else next = current < 0 ? items.length - 1 : Math.max(current - 1, 0);
      e.preventDefault();
      items[next]?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, menuRef]);
}
