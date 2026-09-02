import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bookmark, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

type BookmarkItem = { id: string; label: string; path: string };
type EditState = { bookmarkId: string | null; label: string; path: string };

const STORAGE_KEY = 'app_bookmarks';

function loadBookmarks(): BookmarkItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BookmarkItem[]) : [];
  } catch {
    return [];
  }
}

function persistBookmarks(items: BookmarkItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

const PAGE_NAMES: Record<string, string> = {
  '/': 'Dashboard',
  '/customers': 'Customers',
  '/invoices': 'Invoices',
  '/payments': 'Payments',
  '/credit-memos': 'Credit Memos',
  '/reports/aging': 'AR Aging',
  '/ap/overview': 'AP Overview',
  '/ap/expenses': 'Expense Transactions',
  '/ap/vendors': 'Vendors',
  '/ap/bills': 'Bills',
  '/ap/bill-payments': 'Bill Payments',
  '/ap/vendor-credits': 'Vendor Credits',
  '/ap/contractors': 'Contractors',
  '/reports/1099': '1099s',
  '/accounting/client-overview': 'Client Overview',
  '/accounting/books-review': 'Books Review',
  '/accounting/bank-accounts': 'Bank Accounts',
  '/accounting/bank-transactions': 'Bank Transactions',
  '/accounting/email-imports': 'Email Import Review',
  '/accounting/invoice-imports': 'Email Import Review',
  '/accounting/integrations': 'Integration Transactions',
  '/accounting/receipts': 'Receipts',
  '/accounting/reconcile': 'Reconcile',
  '/accounting/rules': 'Bank Rules',
  '/settings/coa': 'Chart of Accounts',
  '/accounting/recurring': 'Recurring Transactions',
  '/accounting/fixed-assets': 'Fixed Assets',
  '/journal': 'Journal Entries',
  '/reports/standard': 'Standard Reports',
  '/reports/pnl': 'Profit & Loss',
  '/reports/balance-sheet': 'Balance Sheet',
  '/reports/cash-flow': 'Cash Flow',
  '/reports/custom': 'Custom Reports',
  '/reports/management': 'Management Reports',
  '/reports/performance': 'Performance Center',
  '/reports/financial-planning': 'Financial Planning',
  '/reports/spreadsheet-sync': 'Spreadsheet Sync',
  '/reports/trial-balance': 'Trial Balance',
  '/payroll/overview': 'Payroll Overview',
  '/payroll/employees': 'Employees',
  '/payroll/contractors': 'Payroll Contractors',
  '/payroll/taxes': 'Payroll Taxes',
  '/payroll/compliance': 'Compliance',
  '/inventory/overview': 'Inventory Overview',
  '/inventory/items': 'Inventory Items',
  '/inventory/purchase-orders': 'Purchase Orders',
  '/inventory/item-receipts': 'Item Receipts',
  '/inventory/sales-orders': 'Sales Orders',
  '/inventory/shipping-labels': 'Shipping Labels',
  '/setup/entity': 'Entity',
  '/setup/coa': 'Chart of Accounts Setup',
  '/setup/cost-centers': 'Cost Centers',
  '/setup/users': 'Users',
  '/settings/tax-codes': 'Tax Codes',
  '/settings/periods': 'Fiscal Periods',
};

function getPageName(pathname: string): string {
  return (
    PAGE_NAMES[pathname] ??
    pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') ??
    'This page'
  );
}

export function BookmarkMenu() {
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(loadBookmarks);
  const [editing, setEditing] = useState<EditState | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleClose() {
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setEditing(null);
    }, 200);
  }

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  function openMenu() {
    cancelClose();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPopupPos({ top: rect.top, left: rect.right + 4 });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); setEditing(null); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const currentBookmark = useMemo(
    () => bookmarks.find(bm => bm.path === location.pathname) ?? null,
    [bookmarks, location.pathname],
  );

  function handleBookmarkCurrentPage() {
    if (currentBookmark) {
      // Already bookmarked — open its edit form
      setEditing({ bookmarkId: currentBookmark.id, label: currentBookmark.label, path: currentBookmark.path });
    } else {
      setEditing({ bookmarkId: null, label: getPageName(location.pathname), path: location.pathname });
    }
  }

  function handleClickBookmark(bm: BookmarkItem) {
    navigate(bm.path);
    setEditing({ bookmarkId: bm.id, label: bm.label, path: bm.path });
  }

  function handleSave() {
    if (!editing) return;
    const label = editing.label.trim() || getPageName(editing.path);
    if (editing.bookmarkId === null) {
      const updated = [...bookmarks, { id: crypto.randomUUID(), label, path: editing.path }];
      setBookmarks(updated);
      persistBookmarks(updated);
    } else {
      const updated = bookmarks.map(bm =>
        bm.id === editing.bookmarkId ? { ...bm, label } : bm,
      );
      setBookmarks(updated);
      persistBookmarks(updated);
    }
    setEditing(null);
  }

  function handleRemove() {
    if (!editing) return;
    if (editing.bookmarkId === null) {
      setEditing(null);
      return;
    }
    const updated = bookmarks.filter(bm => bm.id !== editing.bookmarkId);
    setBookmarks(updated);
    persistBookmarks(updated);
    setEditing(null);
  }

  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{ position: 'fixed', top: popupPos.top, left: popupPos.left, zIndex: 9999 }}
          className="w-64 rounded-lg border bg-card shadow-card overflow-hidden"
        >
          {/* Header */}
          <div className="border-b px-3 py-2">
            <span className="text-sm font-semibold text-foreground">Bookmarks</span>
          </div>

          {/* Bookmark list */}
          <div className="py-1 max-h-60 overflow-y-auto">
            {bookmarks.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No bookmarks yet. Bookmark a page to find it quickly.
              </p>
            ) : (
              bookmarks.map(bm => (
                <button
                  key={bm.id}
                  type="button"
                  onClick={() => handleClickBookmark(bm)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60',
                    editing?.bookmarkId === bm.id && 'bg-accent text-accent-foreground',
                  )}
                >
                  <Bookmark className="h-3.5 w-3.5 shrink-0 fill-current text-primary" />
                  <span className="truncate">{bm.label}</span>
                </button>
              ))
            )}
          </div>

          {/* Bookmark current page button */}
          <div className="border-t">
            <button
              type="button"
              onClick={handleBookmarkCurrentPage}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-primary transition-colors hover:bg-muted/60"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span>{currentBookmark ? 'Edit bookmark for this page' : 'Bookmark current page'}</span>
            </button>
          </div>

          {/* Edit / Create form */}
          {editing && (
            <div className="border-t bg-muted/20 p-3 space-y-2.5">
              <p className="text-xs font-semibold text-foreground">
                {editing.bookmarkId === null ? 'Create bookmark' : 'Edit bookmark'}
              </p>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Bookmark label</label>
                <input
                  autoFocus
                  type="text"
                  value={editing.label}
                  onChange={e => setEditing(s => s ? { ...s, label: e.target.value } : s)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(null); }}
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRemove}
                  className="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  {editing.bookmarkId === null ? 'Cancel' : 'Remove'}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="px-3 py-1">
      <button
        ref={buttonRef}
        type="button"
        onMouseEnter={openMenu}
        onMouseLeave={scheduleClose}
        onClick={() => (open ? (setOpen(false), setEditing(null)) : openMenu())}
        aria-label="Bookmarks"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-muted hover:bg-sidebar-hover hover:text-white"
      >
        <Bookmark className="h-4 w-4 shrink-0" />
        <span>Bookmarks</span>
        {bookmarks.length > 0 && (
          <span className="ml-auto rounded-full bg-gold/20 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
            {bookmarks.length}
          </span>
        )}
      </button>
      {panel}
    </div>
  );
}
