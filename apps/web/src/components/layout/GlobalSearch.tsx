import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

type Page = { label: string; group: string; to: string };

const ALL_PAGES: Page[] = [
  { label: 'Dashboard', group: 'Dashboard', to: '/' },
  // Accounts Receivable
  { label: 'Customers', group: 'Accounts Receivable', to: '/customers' },
  { label: 'Invoices', group: 'Accounts Receivable', to: '/invoices' },
  { label: 'Payments', group: 'Accounts Receivable', to: '/payments' },
  { label: 'Credit Memos', group: 'Accounts Receivable', to: '/credit-memos' },
  { label: 'AR Aging', group: 'Accounts Receivable', to: '/reports/aging' },
  // Accounts Payable
  { label: 'AP Overview', group: 'Accounts Payable', to: '/ap/overview' },
  { label: 'Expense Transactions', group: 'Accounts Payable', to: '/ap/expenses' },
  { label: 'Vendors', group: 'Accounts Payable', to: '/ap/vendors' },
  { label: 'Bills', group: 'Accounts Payable', to: '/ap/bills' },
  { label: 'Bill Payments', group: 'Accounts Payable', to: '/ap/bill-payments' },
  { label: 'Vendor Credits', group: 'Accounts Payable', to: '/ap/vendor-credits' },
  { label: 'Contractors', group: 'Accounts Payable', to: '/ap/contractors' },
  { label: '1099s', group: 'Accounts Payable', to: '/reports/1099' },
  // Accounting
  { label: 'Client Overview', group: 'Accounting', to: '/accounting/client-overview' },
  { label: 'Books Review', group: 'Accounting', to: '/accounting/books-review' },
  { label: 'Bank Accounts', group: 'Accounting', to: '/accounting/bank-accounts' },
  { label: 'Bank Transactions', group: 'Accounting', to: '/accounting/bank-transactions' },
  { label: 'Email Import Review', group: 'Accounting', to: '/accounting/email-imports' },
  { label: 'Integration Transactions', group: 'Accounting', to: '/accounting/integrations' },
  { label: 'Receipts', group: 'Accounting', to: '/accounting/receipts' },
  { label: 'Reconcile', group: 'Accounting', to: '/accounting/reconcile' },
  { label: 'Bank Rules', group: 'Accounting', to: '/accounting/rules' },
  { label: 'Chart of Accounts', group: 'Accounting', to: '/settings/coa' },
  { label: 'Recurring Transactions', group: 'Accounting', to: '/accounting/recurring' },
  { label: 'Fixed Assets', group: 'Accounting', to: '/accounting/fixed-assets' },
  { label: 'Journal Entries', group: 'Accounting', to: '/journal' },
  // Reports
  { label: 'Standard Reports', group: 'Reports', to: '/reports/standard' },
  { label: 'Profit & Loss', group: 'Reports', to: '/reports/pnl' },
  { label: 'Balance Sheet', group: 'Reports', to: '/reports/balance-sheet' },
  { label: 'Cash Flow', group: 'Reports', to: '/reports/cash-flow' },
  { label: 'Custom Reports', group: 'Reports', to: '/reports/custom' },
  { label: 'Management Reports', group: 'Reports', to: '/reports/management' },
  { label: 'Performance Center', group: 'Reports', to: '/reports/performance' },
  { label: 'Financial Planning', group: 'Reports', to: '/reports/financial-planning' },
  { label: 'Spreadsheet Sync', group: 'Reports', to: '/reports/spreadsheet-sync' },
  { label: 'Trial Balance', group: 'Reports', to: '/reports/trial-balance' },
  // Payroll
  { label: 'Payroll Overview', group: 'Payroll', to: '/payroll/overview' },
  { label: 'Employees', group: 'Payroll', to: '/payroll/employees' },
  { label: 'Payroll Contractors', group: 'Payroll', to: '/payroll/contractors' },
  { label: 'Payroll Taxes', group: 'Payroll', to: '/payroll/taxes' },
  { label: 'Compliance', group: 'Payroll', to: '/payroll/compliance' },
  // Inventory
  { label: 'Inventory Overview', group: 'Inventory', to: '/inventory/overview' },
  { label: 'Inventory Items', group: 'Inventory', to: '/inventory/items' },
  { label: 'Purchase Orders', group: 'Inventory', to: '/inventory/purchase-orders' },
  { label: 'Item Receipts', group: 'Inventory', to: '/inventory/item-receipts' },
  { label: 'Sales Orders', group: 'Inventory', to: '/inventory/sales-orders' },
  { label: 'Shipping Labels', group: 'Inventory', to: '/inventory/shipping-labels' },
  // Setup
  { label: 'Entity', group: 'Setup', to: '/setup/entity' },
  { label: 'Chart of Accounts Setup', group: 'Setup', to: '/setup/coa' },
  { label: 'Cost Centers', group: 'Setup', to: '/setup/cost-centers' },
  { label: 'Users', group: 'Setup', to: '/setup/users' },
  { label: 'Tax Codes', group: 'Setup', to: '/settings/tax-codes' },
  { label: 'Fiscal Periods', group: 'Setup', to: '/settings/periods' },
];

const QUICK_LINKS: Page[] = [
  { label: 'Invoices', group: 'Accounts Receivable', to: '/invoices' },
  { label: 'Payments', group: 'Accounts Receivable', to: '/payments' },
  { label: 'Bills', group: 'Accounts Payable', to: '/ap/bills' },
  { label: 'Bank Transactions', group: 'Accounting', to: '/accounting/bank-transactions' },
  { label: 'Journal Entries', group: 'Accounting', to: '/journal' },
  { label: 'Profit & Loss', group: 'Reports', to: '/reports/pnl' },
  { label: 'Trial Balance', group: 'Reports', to: '/reports/trial-balance' },
  { label: 'Employees', group: 'Payroll', to: '/payroll/employees' },
];

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase().trim());
  if (idx === -1) return text;
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="bg-yellow-100 text-foreground rounded-[2px]">{text.slice(idx, idx + query.trim().length)}</mark>
      {text.slice(idx + query.trim().length)}
    </span>
  );
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const items = useMemo<Page[]>(() => {
    if (!query.trim()) return QUICK_LINKS;
    const q = query.toLowerCase();
    return ALL_PAGES.filter(
      p => p.label.toLowerCase().includes(q) || p.group.toLowerCase().includes(q),
    );
  }, [query]);

  // Grouped with flat index pre-computed for keyboard nav
  const grouped = useMemo(() => {
    if (!query.trim()) return null;
    const map = new Map<string, Array<{ page: Page; idx: number }>>();
    items.forEach((page, idx) => {
      if (!map.has(page.group)) map.set(page.group, []);
      map.get(page.group)!.push({ page, idx });
    });
    return map;
  }, [items, query]);

  useEffect(() => setActiveIdx(0), [items]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  function go(to: string) {
    navigate(to);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const target = items[activeIdx];
      if (target) go(target.to);
    }
  }

  const isSearching = query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search pages and features…"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
          className="h-9 w-full rounded-md border bg-muted/40 pl-9 pr-16 text-sm placeholder:text-muted-foreground focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:flex">
          ⌘K
        </kbd>
      </div>

      {open && items.length > 0 && (
        <div
          ref={listRef}
          className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-lg border bg-card shadow-card max-h-80 overflow-y-auto"
        >
          {!isSearching && (
            <div className="border-b px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Quick links
            </div>
          )}

          {!isSearching && items.map((page, idx) => (
            <button
              key={page.to}
              type="button"
              data-active={activeIdx === idx}
              onMouseEnter={() => setActiveIdx(idx)}
              onClick={() => go(page.to)}
              className={cn(
                'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
                activeIdx === idx ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
              )}
            >
              <span>{page.label}</span>
              <span className="ml-4 shrink-0 text-xs text-muted-foreground">{page.group}</span>
            </button>
          ))}

          {isSearching && grouped && Array.from(grouped.entries()).map(([group, entries]) => (
            <div key={group}>
              <div className="bg-muted/30 px-3 py-1 text-xs font-semibold text-muted-foreground">
                {group}
              </div>
              {entries.map(({ page, idx }) => (
                <button
                  key={page.to}
                  type="button"
                  data-active={activeIdx === idx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => go(page.to)}
                  className={cn(
                    'flex w-full items-center px-3 py-2 text-left text-sm transition-colors',
                    activeIdx === idx ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                  )}
                >
                  {highlight(page.label, query)}
                </button>
              ))}
            </div>
          ))}

          {isSearching && items.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No pages match &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
