import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { Decimal } from 'decimal.js';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtMoney } from '@/lib/money';

type BsLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: string;
};

type BalanceSheetReport = {
  as_of: string;
  asset_lines: BsLine[];
  assets_total: string;
  liability_lines: BsLine[];
  liabilities_total: string;
  equity_lines: BsLine[];
  equity_total: string;
  net_income_ytd: string;
  liabilities_equity_total: string;
  in_balance: boolean;
};

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed to load Balance Sheet.';
}

const EMPTY_REPORT: BalanceSheetReport = {
  as_of: '',
  asset_lines: [],
  assets_total: '0',
  liability_lines: [],
  liabilities_total: '0',
  equity_lines: [],
  equity_total: '0',
  net_income_ytd: '0',
  liabilities_equity_total: '0',
  in_balance: true,
};

export default function BalanceSheetPage() {
  const [bizId] = useActiveBusinessId();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<BalanceSheetReport>(EMPTY_REPORT);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get<BalanceSheetReport>(
        `/businesses/${bizId}/reports/balance-sheet`,
        { params: { as_of: asOf } },
      );
      setReport(r.data);
    } catch (e: unknown) {
      setErr(pickErr(e));
      setReport(EMPTY_REPORT);
    } finally {
      setLoading(false);
    }
  }, [bizId, asOf]);

  useEffect(() => { void load(); }, [load]);

  const equityPlusNi = useMemo(
    () => new Decimal(report.equity_total || '0').plus(new Decimal(report.net_income_ytd || '0')).toFixed(4),
    [report.equity_total, report.net_income_ytd],
  );

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Balance Sheet</h1>
        <div className="flex items-end gap-2">
          <div>
            <Label>As of</Label>
            <DateInput value={asOf} onChange={e => setAsOf(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <div
        className={
          report.in_balance
            ? 'rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm font-medium text-green-700'
            : 'rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm font-medium text-destructive'
        }
      >
        {report.in_balance ? 'In balance ✓' : 'Out of balance'}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Assets</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3 w-24">Code</th>
                  <th className="text-left p-3">Account</th>
                  <th className="text-right p-3 w-32">Amount</th>
                </tr>
              </thead>
              <tbody>
                {report.asset_lines.length === 0 && (
                  <tr className="border-b last:border-b-0">
                    <td colSpan={3} className="p-3 text-muted-foreground italic">No asset balances.</td>
                  </tr>
                )}
                {report.asset_lines.map(l => (
                  <tr key={l.account_id} className="border-b last:border-b-0">
                    <td className="p-3 font-mono">{l.account_code}</td>
                    <td className="p-3">{l.account_name}</td>
                    <td className="p-3 text-right">{fmtMoney(l.amount)}</td>
                  </tr>
                ))}
                <tr className="font-semibold bg-muted/20">
                  <td colSpan={2} className="p-3 text-right">Total Assets</td>
                  <td className="p-3 text-right">{fmtMoney(report.assets_total)}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Liabilities &amp; Equity</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3 w-24">Code</th>
                  <th className="text-left p-3">Account</th>
                  <th className="text-right p-3 w-32">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-muted/10 font-medium">
                  <td colSpan={3} className="p-3 uppercase text-xs tracking-wide text-muted-foreground">Liabilities</td>
                </tr>
                {report.liability_lines.length === 0 && (
                  <tr className="border-b last:border-b-0">
                    <td colSpan={3} className="p-3 text-muted-foreground italic">No liability balances.</td>
                  </tr>
                )}
                {report.liability_lines.map(l => (
                  <tr key={l.account_id} className="border-b last:border-b-0">
                    <td className="p-3 font-mono">{l.account_code}</td>
                    <td className="p-3">{l.account_name}</td>
                    <td className="p-3 text-right">{fmtMoney(l.amount)}</td>
                  </tr>
                ))}
                <tr className="border-b font-semibold">
                  <td colSpan={2} className="p-3 text-right">Total Liabilities</td>
                  <td className="p-3 text-right">{fmtMoney(report.liabilities_total)}</td>
                </tr>

                <tr className="bg-muted/10 font-medium">
                  <td colSpan={3} className="p-3 uppercase text-xs tracking-wide text-muted-foreground">Equity</td>
                </tr>
                {report.equity_lines.map(l => (
                  <tr key={l.account_id} className="border-b last:border-b-0">
                    <td className="p-3 font-mono">{l.account_code}</td>
                    <td className="p-3">{l.account_name}</td>
                    <td className="p-3 text-right">{fmtMoney(l.amount)}</td>
                  </tr>
                ))}
                <tr className="border-b last:border-b-0">
                  <td className="p-3 font-mono text-muted-foreground">—</td>
                  <td className="p-3 italic">Net Income YTD</td>
                  <td className="p-3 text-right">{fmtMoney(report.net_income_ytd)}</td>
                </tr>
                <tr className="border-b font-semibold">
                  <td colSpan={2} className="p-3 text-right">Total Equity + Net Income</td>
                  <td className="p-3 text-right">{fmtMoney(equityPlusNi)}</td>
                </tr>

                <tr className="font-semibold bg-muted/20">
                  <td colSpan={2} className="p-3 text-right">Total Liabilities + Equity</td>
                  <td className="p-3 text-right">{fmtMoney(report.liabilities_equity_total)}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
