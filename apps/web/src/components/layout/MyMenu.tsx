import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'app_bookmarks';
type BookmarkItem = { id: string; label: string; path: string };

function loadBookmarks(): BookmarkItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BookmarkItem[]) : [];
  } catch {
    return [];
  }
}

// Only items from the QBO My Menu screenshots that exist in our app
const CREATE_ITEMS = [
  { label: 'Expense', to: '/ap/expenses/new' },
  { label: 'Receive payment', to: '/payments/new' },
  { label: 'Journal entry', to: '/journal/new' },
];

const TOOL_ITEMS = [
  { label: 'Reconcile', to: '/accounting/reconcile' },
  { label: 'Close books (Fiscal Periods)', to: '/settings/periods' },
];

export function MyMenu() {
  const [open, setOpen] = useState(false);
  const [panelLeft, setPanelLeft] = useState(0);
  const [panelTop, setPanelTop] = useState(0);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(loadBookmarks);
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setBookmarks(loadBookmarks());
  }, [open]);

  function openMenu() {
    if (buttonRef.current) {
      let el: HTMLElement | null = buttonRef.current;
      while (el && el.tagName !== 'ASIDE') el = el.parentElement;
      const sidebar = el?.getBoundingClientRect();
      setPanelLeft(sidebar ? sidebar.right : buttonRef.current.getBoundingClientRect().right);
      setPanelTop(sidebar ? sidebar.top : 0);
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    function onDown(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  function go(to: string) { navigate(to); setOpen(false); }

  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: panelTop, left: panelLeft, bottom: 0, zIndex: 9999 }}
          className="w-56 flex flex-col border-r bg-card shadow-card"
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              My Menu
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            {/* BOOKMARKS */}
            <section className="py-2">
              <p className="px-4 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Bookmarks
              </p>
              {bookmarks.length === 0 ? (
                <p className="px-4 py-1.5 text-xs italic text-muted-foreground">No bookmarks saved.</p>
              ) : (
                bookmarks.map(bm => (
                  <button
                    key={bm.id}
                    type="button"
                    onClick={() => go(bm.path)}
                    className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm transition-colors hover:bg-muted/60"
                  >
                    <Bookmark className="h-3.5 w-3.5 shrink-0 fill-current text-primary" />
                    <span className="truncate">{bm.label}</span>
                  </button>
                ))
              )}
            </section>

            {/* CREATE */}
            <section className="border-t py-2">
              <p className="px-4 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Create
              </p>
              {CREATE_ITEMS.map(item => (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => go(item.to)}
                  className="flex w-full items-center px-4 py-1.5 text-left text-sm transition-colors hover:bg-muted/60"
                >
                  {item.label}
                </button>
              ))}
            </section>

            {/* TOOLS */}
            <section className="border-t py-2">
              <p className="px-4 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Tools
              </p>
              {TOOL_ITEMS.map(item => (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => go(item.to)}
                  className="flex w-full items-center px-4 py-1.5 text-left text-sm transition-colors hover:bg-muted/60"
                >
                  {item.label}
                </button>
              ))}
            </section>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="px-3 py-1">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-label="My Menu"
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          open
            ? 'bg-sidebar-active text-white'
            : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-white',
        )}
      >
        <Menu className="h-4 w-4 shrink-0" />
        <span>My Menu</span>
      </button>
      {panel}
    </div>
  );
}
