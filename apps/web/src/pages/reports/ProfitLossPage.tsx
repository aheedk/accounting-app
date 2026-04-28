import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtMoney, fmtSigned } from '@/lib/money';

type PnlLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: string;
};

type PnlReport = {
  period_start: string;
  period_end: string;
  revenue_lines: PnlLine[];
  revenue_total: string;
  expense_lines: PnlLine[];
  expense_total: string;
  gross_profit: string;
  operating_expenses_total: string;
  operating_income: string;
  other_expenses_total: string;
  net_income: string;
};

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed to load report';
}

function monthRange(now: Date): { start: string; end: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const iso = (d: Date): string => {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };
  return { start: iso(first), end: iso(last) };
}

export default function ProfitLossPage() {
  const [bizId] = useActiveBusinessId();
  const defaults = monthRange(new Date());
  const [periodStart, setPeriodStart] = useState<string>(defaults.start);
  const [periodEnd, setPeriodEnd] = useState<string>(defaults.end);
  const [report, setReport] = useState<PnlReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get<PnlReport>(`/businesses/${bizId}/reports/pnl`, {
        params: { period_start: periodStart, period_end: periodEnd },
      });
      setReport(r.data);
    } catch (e: unknown) {
      setErr(pickErr(e));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [bizId, periodStart, periodEnd]);

  useEffect(() => { void load(); }, [load]);

  if (!bizId) return <div>Pick a business.</div>;

  const netIncomeNum = report ? parseFloat(report.net_income) : 0;
  const netIncomeClass = netIncomeNum >= 0 ? 'text-emerald-600' : 'text-destructive';
  const hasActivity = report && (report.revenue_lines.length > 0 || report.expense_lines.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Profit &amp; Loss</h1>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Period start</Label>
              <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
            </div>
            <div>
              <Label>Period end</Label>
              <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
            </div>
            <Button onClick={() => { void load(); }} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {err && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">Revenue Total</div>
                <div className="mt-1 text-2xl font-semibold">{fmtMoney(report.revenue_total)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">Expense Total</div>
                <div className="mt-1 text-2xl font-semibold">{fmtMoney(report.expense_total)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">Net Income</div>
                <div className={`mt-1 text-2xl font-semibold ${netIncomeClass}`}>{fmtSigned(report.net_income)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="mb-3 text-sm font-semibold">Performance breakdown</div>
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Gross Profit</div>
                  <div className="mt-1 font-medium">{fmtSigned(report.gross_profit)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Operating Expenses</div>
                  <div className="mt-1 font-medium">{fmtMoney(report.operating_expenses_total)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Operating Income</div>
                  <div className="mt-1 font-medium">{fmtSigned(report.operating_income)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Other Expenses</div>
                  <div className="mt-1 font-medium">{fmtMoney(report.other_expenses_total)}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {!hasActivity ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No activity in this period.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card>
                <CardContent className="p-0">
                  <div className="border-b p-3 text-sm font-semibold">Revenue</div>
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <th className="p-3 text-left">Code</th>
                        <th className="p-3 text-left">Account</th>
                        <th className="p-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.revenue_lines.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-3 text-center text-muted-foreground">No revenue recorded.</td>
                        </tr>
                      ) : (
                        report.revenue_lines.map(r => (
                          <tr key={r.account_id} className="border-b last:border-b-0">
                            <td className="p-3 font-mono">{r.account_code}</td>
                            <td className="p-3">{r.account_name}</td>
                            <td className="p-3 text-right">{fmtMoney(r.amount)}</td>
                          </tr>
                        ))
                      )}
                      <tr className="bg-muted/20 font-semibold">
                        <td colSpan={2} className="p-3 text-right">Total Revenue</td>
                        <td className="p-3 text-right">{fmtMoney(report.revenue_total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0">
                  <div className="border-b p-3 text-sm font-semibold">Expense</div>
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <th className="p-3 text-left">Code</th>
                        <th className="p-3 text-left">Account</th>
                        <th className="p-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.expense_lines.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-3 text-center text-muted-foreground">No expenses recorded.</td>
                        </tr>
                      ) : (
                        report.expense_lines.map(r => (
                          <tr key={r.account_id} className="border-b last:border-b-0">
                            <td className="p-3 font-mono">{r.account_code}</td>
                            <td className="p-3">{r.account_name}</td>
                            <td className="p-3 text-right">{fmtMoney(r.amount)}</td>
                          </tr>
                        ))
                      )}
                      <tr className="bg-muted/20 font-semibold">
                        <td colSpan={2} className="p-3 text-right">Total Expense</td>
                        <td className="p-3 text-right">{fmtMoney(report.expense_total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
