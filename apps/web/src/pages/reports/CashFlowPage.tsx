import { useCallback, useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { fmtMoney } from '@/lib/money';
import { DownloadButtons } from '@/components/ui/DownloadButtons';

type CashFlowLine = {
  entry_date: string;
  journal_entry_id: string;
  source_type: string;
  memo: string | null;
  debit: string;
  credit: string;
  net_amount: string;
  running_balance: string;
};

type CashFlowReport = {
  period_start: string;
  period_end: string;
  cash_account_id: string;
  cash_account_code: string;
  cash_account_name: string;
  beginning_balance: string;
  ending_balance: string;
  net_change: string;
  lines: CashFlowLine[];
};

type BankAccount = {
  id: string;
  name: string;
  cash_account_id: string;
  cash_account_code: string;
  cash_account_name: string;
};

function defaultPeriodStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function defaultPeriodEnd(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

function netClass(net: string): string {
  const v = parseFloat(net);
  if (v > 0) return 'text-emerald-600';
  if (v < 0) return 'text-rose-600';
  return '';
}

export default function CashFlowPage() {
  const [bizId] = useActiveBusinessId();
  const [periodStart, setPeriodStart] = useState<string>(defaultPeriodStart());
  const [periodEnd, setPeriodEnd] = useState<string>(defaultPeriodEnd());
  const [cashAccountId, setCashAccountId] = useState<string>('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [report, setReport] = useState<CashFlowReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const load = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    try {
      const params: { period_start: string; period_end: string; cash_account_id?: string } = {
        period_start: periodStart,
        period_end: periodEnd,
      };
      if (cashAccountId) params.cash_account_id = cashAccountId;
      const r = await api.get<CashFlowReport>(`/businesses/${bizId}/reports/cash-flow`, { params });
      setReport(r.data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to load report');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [bizId, periodStart, periodEnd, cashAccountId]);

  useEffect(() => {
    if (!bizId) return;
    api.get<{ bank_accounts: BankAccount[] }>(`/businesses/${bizId}/bank-accounts`)
      .then(r => setBankAccounts(r.data.bank_accounts))
      .catch(() => setBankAccounts([]));
  }, [bizId]);

  useEffect(() => { load(); }, [load]);

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cash Flow Statement</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <Label>Period start</Label>
              <DateInput value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
            </div>
            <div>
              <Label>Period end</Label>
              <DateInput value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
            </div>
            <div>
              <Label>Cash account</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={cashAccountId}
                onChange={e => setCashAccountId(e.target.value)}
              >
                <option value="">Default</option>
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.cash_account_id}>
                    {b.cash_account_code} — {b.cash_account_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button onClick={() => load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
            </div>
          </div>
          {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        </CardContent>
      </Card>

      {report && (
        <>
          <DownloadButtons
            headers={['Date', 'Source', 'Memo', 'Debit', 'Credit', 'Net', 'Running Balance']}
            getRows={() => report.lines.map(l => [l.entry_date, l.source_type, l.memo ?? '', l.debit, l.credit, l.net_amount, l.running_balance])}
            filename={`cash-flow-${periodStart}-${periodEnd}`}
            title={`Cash Flow — ${periodStart} to ${periodEnd}`}
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Beginning Balance</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{fmtMoney(report.beginning_balance)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Net Change</CardTitle></CardHeader>
              <CardContent><div className={`text-2xl font-semibold ${netClass(report.net_change)}`}>{fmtMoney(report.net_change)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Ending Balance</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{fmtMoney(report.ending_balance)}</div></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                Activity — {report.cash_account_code} — {report.cash_account_name}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {report.lines.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No cash activity in this period</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="text-left p-3">Date</th>
                      <th className="text-left p-3">Source</th>
                      <th className="text-left p-3">Memo</th>
                      <th className="text-right p-3">Debit</th>
                      <th className="text-right p-3">Credit</th>
                      <th className="text-right p-3">Net</th>
                      <th className="text-right p-3">Running Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.lines.map(l => (
                      <tr key={l.journal_entry_id} className="border-b last:border-b-0">
                        <td className="p-3">{l.entry_date}</td>
                        <td className="p-3"><span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize">{l.source_type}</span></td>
                        <td className="p-3">{l.memo ?? ''}</td>
                        <td className="p-3 text-right">{fmtMoney(l.debit)}</td>
                        <td className="p-3 text-right">{fmtMoney(l.credit)}</td>
                        <td className={`p-3 text-right ${netClass(l.net_amount)}`}>{fmtMoney(l.net_amount)}</td>
                        <td className="p-3 text-right">{fmtMoney(l.running_balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
