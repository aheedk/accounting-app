import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, MoreVertical, Star } from 'lucide-react';
import { useCanOpen } from '@/lib/roleAccess';
import { useActiveBusinessId } from '@/lib/business';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

type ReportLink = { to: string; name: string; description: string };
type ReportGroup = { heading: string; reports: ReportLink[] };

// Grouped to mirror QuickBooks' "Standard" reports page categories.
const groups: ReportGroup[] = [
  {
    heading: 'Business overview',
    reports: [
      { to: '/reports/pnl', name: 'Profit and Loss', description: 'Revenue and expenses for a period, with gross profit and net income.' },
      { to: '/reports/pnl-detail', name: 'Profit and Loss Detail', description: 'Every transaction behind the Profit and Loss, under its account.' },
      { to: '/reports/pnl-by-month', name: 'Profit and Loss by Month', description: 'The Profit and Loss with a column for each month, and the total.' },
      { to: '/reports/pnl-quarterly', name: 'Quarterly Profit and Loss Summary', description: 'The Profit and Loss with a column for each quarter of the fiscal year, and the total.' },
      { to: '/reports/pnl-comparison', name: 'Profit and Loss Comparison', description: 'This period against the same period a year earlier, with the change in dollars and percent.' },
      { to: '/reports/pnl-ytd-comparison', name: 'Profit and Loss Year-to-Date Comparison', description: 'The period beside the fiscal year to date.' },
      { to: '/reports/pnl-percent-of-income', name: 'Profit and Loss as % of Total Income', description: 'Each line of the Profit and Loss as a share of total income.' },
      { to: '/reports/pnl-by-customer', name: 'Profit and Loss by Customer', description: 'The Profit and Loss with a column for each customer.' },
      { to: '/reports/balance-sheet', name: 'Balance Sheet', description: 'Assets, liabilities, and equity as of a point in time.' },
      { to: '/reports/balance-sheet-summary', name: 'Balance Sheet Summary', description: 'The Balance Sheet with one line for each account type.' },
      { to: '/reports/balance-sheet-detail', name: 'Balance Sheet Detail', description: 'Each balance sheet account from its beginning balance, through the transactions in the period, to where it ends.' },
      { to: '/reports/balance-sheet-comparison', name: 'Balance Sheet Comparison', description: 'The Balance Sheet against the same date a year earlier, with the change in dollars and percent.' },
      { to: '/reports/statement-of-cash-flows', name: 'Statement of Cash Flows', description: 'The change in cash for a period, explained as operating, investing and financing activities.' },
      { to: '/reports/financial-planning', name: 'Budget vs. Actuals', description: 'A budget, and how what was posted compares with it.' },
      { to: '/setup/activity', name: 'Audit Log', description: 'Who added, changed or deleted what, and when.' },
    ],
  },
  {
    heading: 'For my accountant',
    reports: [
      { to: '/reports/general-ledger', name: 'General Ledger', description: 'Detailed transactions, opening balances, and running balances grouped by account.' },
      { to: '/reports/account-list', name: 'Account List', description: 'Every account in the chart, grouped by type, with its detail type and balance.' },
      { to: '/reports/journal', name: 'Journal', description: 'Every transaction in the period with all of its debits and credits.' },
      { to: '/reports/transaction-list-by-date', name: 'Transaction List by Date', description: 'One line for each transaction in the period, by date.' },
      { to: '/reports/transaction-list-with-splits', name: 'Transaction List with Splits', description: 'Each transaction in the period with every account it touches.' },
      { to: '/reports/transaction-detail-by-account', name: 'Transaction Detail by Account', description: 'The transactions in the period under each account, the balance running from zero.' },
      { to: '/reports/recent-transactions', name: 'Recent Transactions', description: 'Transactions entered in the last four days, or between the dates you pick, by type.' },
      { to: '/reports/trial-balance', name: 'Trial Balance', description: 'Debit and credit balances for every account as of a chosen date.' },
      { to: '/reports/adjusted-trial-balance', name: 'Adjusted Trial Balance', description: 'Each balance before the period\'s adjusting entries, the adjustments, and after.' },
      { to: '/reports/cash-flow', name: 'Cash Activity by Account', description: 'Every movement in one bank account over a period, with a running balance.' },
      { to: '/accounting/recurring', name: 'Recurring Template List', description: 'Every recurring transaction template, how often it runs and when it runs next.' },
      { to: '/reports/reconciliation', name: 'Reconciliation Reports', description: 'Every completed reconciliation, fixed as it was the day it was finished — the balances, the cleared transactions, and a PDF copy.' },
      { to: '/reports/closing-date-exceptions', name: 'Closing Date Exception Report', description: 'Every transaction that changed a closed period\'s own numbers after it closed.' },
    ],
  },
  {
    heading: 'Who owes you',
    reports: [
      { to: '/reports/aging', name: 'Accounts Receivable Aging Summary', description: 'Outstanding customer invoices bucketed by days past due, less unapplied payments and credits.' },
      { to: '/reports/customer-balances', name: 'Customer Balance Summary', description: 'Each customer\'s current open balance, with no bucket breakdown.' },
      { to: '/reports/open-invoices', name: 'Open Invoices', description: 'Every invoice still carrying a balance, one row each, due soonest first.' },
      { to: '/reports/ar-aging-detail', name: 'A/R Aging Detail', description: 'Open invoices grouped under their aging bucket, one row each.' },
      { to: '/reports/customer-balance-detail', name: 'Customer Balance Detail', description: 'Open invoices grouped under each customer, one row each.' },
      { to: '/reports/collections', name: 'Collections Report', description: 'Invoices past due, under each customer with their phone number, and how many days late.' },
      { to: '/reports/invoice-list', name: 'Invoice List', description: 'Every invoice dated in the period, with its status and what is still owed.' },
      { to: '/reports/invoices-and-payments', name: 'Invoices and Received Payments', description: 'Each invoice dated in the period, with the payments and credits applied to it, and what is still owed.' },
    ],
  },
  {
    heading: 'Sales and customers',
    reports: [
      { to: '/reports/sales-by-customer', name: 'Sales by Customer Summary', description: 'Income from invoices, credit memos and deposits, for each customer.' },
      { to: '/reports/sales-by-product', name: 'Sales by Product/Service Summary', description: 'Income from invoice lines, for each product or service.' },
      { to: '/reports/sales-by-customer-detail', name: 'Sales by Customer Detail', description: 'The sales behind Sales by Customer Summary, line by line, under each customer.' },
      { to: '/reports/income-by-customer', name: 'Income by Customer Summary', description: 'Each customer\'s income, the costs that name them, and what is left.' },
      { to: '/reports/transaction-list-by-customer', name: 'Transaction List by Customer', description: 'Every transaction in the period under the customer it names.' },
      { to: '/reports/deposit-detail', name: 'Deposit Detail', description: 'What went into each bank account, with where it came from under it.' },
      { to: '/reports/estimates-by-customer', name: 'Estimates by Customer', description: 'The estimates dated in the period, under each customer, with their status.' },
      { to: '/reports/customer-contact-list', name: 'Customer Contact List', description: 'Each active customer\'s phone numbers, email, contact name and addresses.' },
      { to: '/reports/product-service-list', name: 'Product/Service List', description: 'Every active item with its price, cost and quantity on hand.' },
      { to: '/reports/inventory-valuation-summary', name: 'Inventory Valuation Summary', description: 'Each item\'s quantity on hand as of a date, what it cost, and the average cost.' },
      { to: '/reports/inventory-valuation-detail', name: 'Inventory Valuation Detail', description: 'Each item\'s stock from the start of the period, through every movement, with the quantity and value running.' },
      { to: '/reports/physical-inventory-worksheet', name: 'Physical Inventory Worksheet', description: 'Each item with the quantity on hand and on order, and a blank column to count into.' },
    ],
  },
  {
    heading: 'What you owe',
    reports: [
      { to: '/reports/ap-aging', name: 'Accounts Payable Aging Summary', description: 'Unpaid vendor bills bucketed by days past due, less unused vendor credits.' },
      { to: '/reports/vendor-balances', name: 'Vendor Balance Summary', description: 'Each vendor\'s current open balance, with no bucket breakdown.' },
      { to: '/reports/unpaid-bills', name: 'Unpaid Bills', description: 'Every bill still carrying a balance, one row each, due soonest first.' },
      { to: '/reports/ap-aging-detail', name: 'A/P Aging Detail', description: 'Unpaid bills grouped under their aging bucket, one row each.' },
      { to: '/reports/vendor-balance-detail', name: 'Vendor Balance Detail', description: 'Unpaid bills grouped under each vendor, one row each.' },
      { to: '/reports/bill-payment-list', name: 'Bill Payment List', description: 'Every bill payment in the period, under the account it was paid from.' },
    ],
  },
  {
    heading: 'Expenses and vendors',
    reports: [
      { to: '/reports/expenses-by-vendor', name: 'Expenses by Vendor Summary', description: 'Everything spent in the period, for each vendor or payee.' },
      { to: '/reports/purchases-by-vendor-detail', name: 'Purchases by Vendor Detail', description: 'What was bought from each vendor, line by line, less vendor credits.' },
      { to: '/reports/transaction-list-by-vendor', name: 'Transaction List by Vendor', description: 'Every transaction in the period under the vendor it names.' },
      { to: '/reports/check-detail', name: 'Check Detail', description: 'Every check written in the period, with what it paid for under it.' },
      { to: '/reports/open-purchase-orders', name: 'Open Purchase Order List', description: 'Purchase orders not yet received, closed or voided, under each vendor.' },
      { to: '/reports/open-purchase-order-detail', name: 'Open Purchase Order Detail', description: 'Each line of the purchase orders not yet received, under each vendor.' },
      { to: '/reports/vendor-contact-list', name: 'Vendor Contact List', description: 'Each active vendor\'s phone numbers, email, contact name, address and account number.' },
      { to: '/reports/1099', name: '1099 Transaction Detail Report', description: 'Annual payments to 1099 vendors, grouped by vendor and tax ID.' },
    ],
  },
  {
    heading: 'Sales tax',
    reports: [
      { to: '/reports/sales-tax-liability', name: 'Sales Tax Liability Report', description: 'The tax charged on the period\'s invoices under each tax code, with the sales it was charged on.' },
      { to: '/reports/sales-tax-by-agency', name: 'Sales Tax by Agency', description: 'The same figures as Sales Tax Liability, grouped under the authority each code is owed to.' },
    ],
  },
];

const allReports: ReportLink[] = groups.flatMap(g => g.reports);

function favoritesKey(businessId: string | null): string {
  return `report-favorites-${businessId ?? 'none'}`;
}

function loadFavorites(businessId: string | null): Set<string> {
  try {
    const raw = localStorage.getItem(favoritesKey(businessId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Left column first, then right — like a newspaper, not row by row. */
function twoColumns<T>(items: T[]): [T[], T[]] {
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
}

function ReportRow({ report, favorite, onToggleFavorite }: { report: ReportLink; favorite: boolean; onToggleFavorite: () => void }) {
  return (
    <div className="group flex items-center justify-between gap-2 py-1.5 sm:py-1">
      <Link to={report.to} className="truncate text-sm text-foreground hover:text-primary hover:underline">
        {report.name}
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          className="rounded p-0.5 text-muted-foreground hover:text-primary"
        >
          <Star className={`h-4 w-4 ${favorite ? 'fill-primary text-primary' : ''}`} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Report options" className="rounded p-0.5 text-muted-foreground hover:text-primary">
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={onToggleFavorite}>
              {favorite ? 'Remove from favorites' : 'Add to favorites'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ReportSection({
  heading, reports, favorites, onToggleFavorite,
}: {
  heading: string; reports: ReportLink[]; favorites: Set<string>; onToggleFavorite: (to: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [left, right] = twoColumns(reports);
  return (
    <section className="border-b pb-4 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 py-2 text-lg font-semibold text-foreground"
      >
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
        {heading}
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2">
          <div className="divide-y">
            {left.map(r => <ReportRow key={r.to} report={r} favorite={favorites.has(r.to)} onToggleFavorite={() => onToggleFavorite(r.to)} />)}
          </div>
          <div className="divide-y">
            {right.map(r => <ReportRow key={r.to} report={r} favorite={favorites.has(r.to)} onToggleFavorite={() => onToggleFavorite(r.to)} />)}
          </div>
        </div>
      )}
    </section>
  );
}

export default function StandardReportsPage() {
  // A report the role cannot open is left off, as in the sidebar and search.
  const canOpen = useCanOpen();
  const [businessId] = useActiveBusinessId();
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites(businessId));
  const [query, setQuery] = useState('');

  const visible = useMemo(
    () => groups
      .map(group => ({ ...group, reports: group.reports.filter(r => canOpen(r.to)) }))
      .filter(group => group.reports.length > 0),
    [canOpen],
  );
  const visibleReports = useMemo(() => visible.flatMap(g => g.reports), [visible]);
  const favoriteReports = useMemo(() => visibleReports.filter(r => favorites.has(r.to)), [visibleReports, favorites]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allReports.filter(r => canOpen(r.to) && r.name.toLowerCase().includes(q));
  }, [query, canOpen]);

  function toggleFavorite(to: string) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(to)) next.delete(to); else next.add(to);
      try { localStorage.setItem(favoritesKey(businessId), JSON.stringify([...next])); } catch { /* best effort */ }
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Standard Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Built-in financial reports generated from the current ledger.
        </p>
      </div>

      <div className="relative max-w-md">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Type report name here"
        />
        {query.trim() && (
          <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-md">
            {matches.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No reports match.</div>}
            {matches.map(r => (
              <Link
                key={r.to}
                to={r.to}
                className="block px-3 py-2 text-sm text-foreground hover:bg-muted/40 hover:text-primary"
                onClick={() => setQuery('')}
              >
                {r.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {!query.trim() && (
        <div className="space-y-4">
          {favoriteReports.length > 0 && (
            <ReportSection heading="Favorites" reports={favoriteReports} favorites={favorites} onToggleFavorite={toggleFavorite} />
          )}
          {visible.map(group => (
            <ReportSection
              key={group.heading} heading={group.heading} reports={group.reports} favorites={favorites} onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      )}
    </div>
  );
}
