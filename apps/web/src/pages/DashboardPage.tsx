import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from '@/lib/business';
import { api } from '@/lib/apiClient';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { humanizeCode } from '@/lib/labels';
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

type AgingRow = { total: string; current: string };
type Summary = {
  cash: number; bankAccounts: number;
  receivable: number; receivableOverdue: number;
  payable: number; payableOverdue: number;
  income: number; expenses: number; profit: number;
};

const sum = (values: Array<string | number | undefined>) => values.reduce<number>((total, value) => total + (Number(value) || 0), 0);

/**
 * Where the client stands today, from the same figures the reports show: bank
 * accounts at their book balance, the two aging reports, and this month's
 * profit and loss. Null until loaded; a failed request leaves the cards out.
 */
function useSummary(bizId: string | null): Summary | null {
  const [state, setState] = useState<{ bizId: string; summary: Summary } | null>(null);
  useEffect(() => {
    if (!bizId) return;
    let live = true;
    const today = todayLocal();
    Promise.all([
      api.get<{ bank_accounts: { book_balance?: string }[] }>(`/businesses/${bizId}/bank-accounts`),
      api.get<{ rows: AgingRow[] }>(`/businesses/${bizId}/reports/aging`, { params: { as_of: today } }),
      api.get<{ rows: AgingRow[] }>(`/businesses/${bizId}/reports/ap-aging`, { params: { as_of: today } }),
      api.get<{ revenue_total: string; expense_total: string; net_income: string }>(
        `/businesses/${bizId}/reports/pnl`, { params: { period_start: `${today.slice(0, 8)}01`, period_end: today } }),
    ]).then(([bank, ar, ap, pnl]) => {
      if (!live) return;
      const owed = (rows: AgingRow[]) => ({ total: sum(rows.map(r => r.total)), overdue: sum(rows.map(r => Number(r.total) - Number(r.current))) });
      const receivable = owed(ar.data.rows);
      const payable = owed(ap.data.rows);
      setState({
        bizId,
        summary: {
          cash: sum(bank.data.bank_accounts.map(a => a.book_balance)), bankAccounts: bank.data.bank_accounts.length,
          receivable: receivable.total, receivableOverdue: receivable.overdue,
          payable: payable.total, payableOverdue: payable.overdue,
          income: Number(pnl.data.revenue_total) || 0, expenses: Number(pnl.data.expense_total) || 0, profit: Number(pnl.data.net_income) || 0,
        },
      });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [bizId]);
  // Another client's numbers are never shown while the new ones load.
  return state && state.bizId === bizId ? state.summary : null;
}

export default function DashboardPage() {
  const { user, businesses } = useAuth();
  const [activeId] = useActiveBusinessId();
  const summary = useSummary(activeId ?? null);
  const summaryCards = summary ? [
    { label: 'Cash in the bank', value: summary.cash, hint: `${summary.bankAccounts} bank account${summary.bankAccounts === 1 ? '' : 's'}, book balance`, to: '/accounting/bank-accounts' },
    { label: 'Owed to you', value: summary.receivable, hint: `${fmtMoney(summary.receivableOverdue.toFixed(2))} past due`, to: '/reports/aging' },
    { label: 'You owe', value: summary.payable, hint: `${fmtMoney(summary.payableOverdue.toFixed(2))} past due`, to: '/reports/ap-aging' },
    { label: 'Profit this month', value: summary.profit, hint: `${fmtMoney(summary.income.toFixed(2))} in, ${fmtMoney(summary.expenses.toFixed(2))} out`, to: '/reports/pnl' },
  ] : [];
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
            ? <>Working in <span className="font-medium text-foreground">{activeBusiness.name}</span>{activeBusiness.name.endsWith('.') ? '' : '.'} Pick a quick action below to jump in.</>
            : 'Select a business from the top bar to get started.'}
        </p>
      </section>

      {/* Where the client stands today */}
      {summaryCards.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Today</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {summaryCards.map(card => (
              <Link key={card.label} to={card.to} className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <Card className="h-full transition-colors hover:border-primary/40 hover:bg-secondary/40">
                  <CardContent className="p-5">
                    <p className="text-sm text-muted-foreground">{card.label}</p>
                    <p className={`mt-1 font-mono text-2xl font-semibold ${card.value < 0 ? 'text-destructive' : ''}`}>{fmtMoney(card.value.toFixed(2))}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

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
            <p><span className="text-muted-foreground">Role</span> <span className="font-medium">{user?.role ? humanizeCode(user.role) : ''}</span></p>
            <p><span className="text-muted-foreground">Businesses</span> <span className="font-medium">{businesses.length}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">What you can do</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Full books in one place: AR (customers, invoices, payments, credits),
            AP (vendors, bills, expenses), banking and reconciliation, journal
            entries, payroll, inventory, and financial reports — all scoped to the
            business selected above.
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
