import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type RevenueByMonth = {
  month: string;
  amount: string;
};

type ExpenseBreakdown = {
  account_code: string;
  account_name: string;
  amount: string;
};

type ManagementReport = {
  revenue_by_month: RevenueByMonth[];
  expense_breakdown: ExpenseBreakdown[];
  total_revenue_last_12: string;
  total_expense_last_12: string;
};

export default function ManagementReportsPage() {
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<ManagementReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bizId) return;
    setData(null);
    setError(null);
    api.get<ManagementReport>(`/businesses/${bizId}/management-report`)
      .then(r => setData(r.data))
      .catch((e: unknown) => {
        const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
        setError(msg ?? (e instanceof Error ? e.message : 'Failed to load management report'));
      });
  }, [bizId]);

  if (!bizId) return <div>Pick a business.</div>;
  if (error) return <div className="text-sm text-destructive">{error}</div>;
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const maxRevenue = data.revenue_by_month.reduce((m, r) => {
    const v = Number(r.amount);
    return Number.isFinite(v) && v > m ? v : m;
  }, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Management Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trailing 12-month KPIs sourced from the live ledger.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Total revenue (12m)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">${fmtMoney(data.total_revenue_last_12)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Total expense (12m)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">${fmtMoney(data.total_expense_last_12)}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Revenue by month</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.revenue_by_month.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No revenue recorded.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3">Month</th>
                  <th className="text-left p-3">Trend</th>
                  <th className="text-right p-3">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.revenue_by_month.map(row => {
                  const v = Number(row.amount);
                  const pct = maxRevenue > 0 && Number.isFinite(v) ? Math.max(0, (v / maxRevenue) * 100) : 0;
                  return (
                    <tr key={row.month} className="border-b last:border-b-0">
                      <td className="p-3 font-mono">{row.month}</td>
                      <td className="p-3">
                        <div className="h-2 w-full rounded bg-muted">
                          <div
                            className="h-2 rounded bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono">${fmtMoney(row.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Top expenses</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.expense_breakdown.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No expenses recorded.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3">Account code</th>
                  <th className="text-left p-3">Account name</th>
                  <th className="text-right p-3">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.expense_breakdown.map(row => (
                  <tr key={row.account_code} className="border-b last:border-b-0">
                    <td className="p-3 font-mono">{row.account_code}</td>
                    <td className="p-3">{row.account_name}</td>
                    <td className="p-3 text-right font-mono">${fmtMoney(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
