import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

type ReportLink = { to: string; name: string; description: string };
type ReportGroup = { heading: string; reports: ReportLink[] };

// Grouped to mirror QuickBooks' "Standard" reports page categories.
const groups: ReportGroup[] = [
  {
    heading: 'Business overview',
    reports: [
      { to: '/reports/pnl', name: 'Profit and Loss', description: 'Revenue and expenses for a period, with gross profit and net income.' },
      { to: '/reports/balance-sheet', name: 'Balance Sheet', description: 'Assets, liabilities, and equity as of a point in time.' },
      { to: '/reports/cash-flow', name: 'Statement of Cash Flows', description: 'Cash account activity over a period with beginning and ending balances.' },
    ],
  },
  {
    heading: 'For my accountant',
    reports: [
      { to: '/reports/trial-balance', name: 'Trial Balance', description: 'Debit and credit balances for every account as of a chosen date.' },
    ],
  },
  {
    heading: 'Who owes you',
    reports: [
      { to: '/reports/aging', name: 'Accounts Receivable Aging Summary', description: 'Outstanding customer invoices bucketed by days past due.' },
    ],
  },
  {
    heading: 'Expenses and vendors',
    reports: [
      { to: '/reports/1099', name: '1099 Transaction Detail Report', description: 'Annual payments to 1099 vendors, grouped by vendor and tax ID.' },
    ],
  },
];

export default function StandardReportsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Standard Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Built-in financial reports generated from the current ledger.
        </p>
      </div>

      {groups.map(group => (
        <section key={group.heading} className="space-y-1">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group.heading}</h2>
          <div className="divide-y rounded-xl border bg-card shadow-card">
            {group.reports.map(r => (
              <Link
                key={r.to}
                to={r.to}
                className="group flex items-center justify-between gap-4 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40"
              >
                <div>
                  <div className="font-medium text-primary">{r.name}</div>
                  <div className="text-sm text-muted-foreground">{r.description}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
