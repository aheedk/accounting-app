import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from '@/lib/business';
import { ArrowRight, FileBarChart, FilePlus2, Receipt, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type QuickAction = {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

const quickActions: QuickAction[] = [
  {
    to: '/invoices/new',
    label: 'New Invoice',
    description: 'Bill a customer for goods or services.',
    icon: FilePlus2,
  },
  {
    to: '/payments/new',
    label: 'Record Payment',
    description: 'Apply a customer payment to open invoices.',
    icon: Wallet,
  },
  {
    to: '/credit-memos/new',
    label: 'New Credit Memo',
    description: 'Issue a credit to offset an invoice.',
    icon: Receipt,
  },
  {
    to: '/reports/trial-balance',
    label: 'Trial Balance',
    description: 'See debit and credit balances as of today.',
    icon: FileBarChart,
  },
];

export default function DashboardPage() {
  const { user, businesses } = useAuth();
  const [activeId] = useActiveBusinessId();
  const activeBusiness = businesses.find(b => b.id === activeId) ?? null;
  const firmPrefix = user?.full_name ? user.full_name.split(' ')[0] : null;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="overflow-hidden rounded-xl border border-primary/10 bg-gradient-to-br from-secondary via-background to-background p-6 md:p-8">
        <p className="text-xs font-medium uppercase tracking-wider text-primary">Dashboard</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          {firmPrefix ? `Welcome back, ${firmPrefix}.` : 'Welcome back.'}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
          {activeBusiness
            ? <>Working in <span className="font-medium text-foreground">{activeBusiness.name}</span>. Pick a quick action below to jump in.</>
            : 'Select a business from the top bar to get started.'}
        </p>
      </section>

      {/* Quick actions */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Quick actions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map(action => {
            const Icon = action.icon;
            return (
              <Link
                key={action.to}
                to={action.to}
                className="group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
              >
                <Card className="h-full transition-colors hover:border-primary/40 hover:bg-secondary/40">
                  <CardHeader>
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <CardTitle className="mt-2 text-base">{action.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{action.description}</p>
                    <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                      Go
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Account */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Signed in as</span> <span className="font-medium">{user?.email}</span></p>
            <p><span className="text-muted-foreground">Role</span> <span className="font-medium">{user?.role}</span></p>
            <p><span className="text-muted-foreground">Businesses</span> <span className="font-medium">{businesses.length}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Where we are</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Slice 1 is live: Ledger, Chart of Accounts, Journal Entries, and AR
            (Customers, Invoices, Payments, Credit Memos) with Trial Balance and AR
            Aging reports. The rest of the sidebar is stubbed for upcoming slices.
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
