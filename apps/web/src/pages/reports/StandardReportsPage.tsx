import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, FileBarChart, Users, Receipt, TrendingUp, Scale, Activity } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type ReportCard = {
  to: string;
  name: string;
  description: string;
  icon: LucideIcon;
};

const reports: ReportCard[] = [
  {
    to: '/reports/pnl',
    name: 'Profit & Loss',
    description: 'Revenue and expenses for a period, with gross profit and net income.',
    icon: TrendingUp,
  },
  {
    to: '/reports/balance-sheet',
    name: 'Balance Sheet',
    description: 'Assets, liabilities, and equity as of a point in time.',
    icon: Scale,
  },
  {
    to: '/reports/cash-flow',
    name: 'Cash Flow Statement',
    description: 'Cash account activity over a period with beginning and ending balances.',
    icon: Activity,
  },
  {
    to: '/reports/trial-balance',
    name: 'Trial Balance',
    description: 'Debit and credit balances for every account as of a chosen date.',
    icon: FileBarChart,
  },
  {
    to: '/reports/aging',
    name: 'AR Aging',
    description: 'Outstanding customer invoices bucketed by days past due.',
    icon: Users,
  },
  {
    to: '/reports/1099',
    name: '1099 Report',
    description: 'Annual payments to 1099 vendors, grouped by vendor and tax ID.',
    icon: Receipt,
  },
];

export default function StandardReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Standard Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Built-in financial reports generated from the current ledger.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {reports.map(r => {
          const Icon = r.icon;
          return (
            <Link
              key={r.to}
              to={r.to}
              className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
            >
              <Card className="h-full transition-colors hover:border-primary/40 hover:bg-secondary/40">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-lg">{r.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{r.description}</p>
                  <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                    Open
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
