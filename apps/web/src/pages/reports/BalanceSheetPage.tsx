import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { Decimal } from 'decimal.js';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { ReportCard } from '@/components/ui/ReportCard';
import { useAuth } from '@/auth/useAuth';
import { fmtMoney } from '@/lib/money';
import { DownloadButtons } from '@/components/ui/DownloadButtons';
import { fmtLongDate, todayLocal } from '@/lib/dates';

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
  const { businesses } = useAuth();
  const bizName = businesses.find(b => b.id === bizId)?.name ?? '';
  const [asOf, setAsOf] = useState(todayLocal());
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

  const dlHeaders = ['Section', 'Code', 'Account', 'Amount'];
  const dlRows = () => [
    ...report.asset_lines.map(l => ['Assets', l.account_code, l.account_name, l.amount]),
    ['Assets', '', 'Total Assets', report.assets_total],
    ...report.liability_lines.map(l => ['Liabilities', l.account_code, l.account_name, l.amount]),
    ['Liabilities', '', 'Total Liabilities', report.liabilities_total],
    ...report.equity_lines.map(l => ['Equity', l.account_code, l.account_name, l.amount]),
    ['Equity', '—', 'Net Income YTD', report.net_income_ytd],
    ['Equity', '', 'Total Equity + Net Income', equityPlusNi],
    ['', '', 'Total Liabilities + Equity', report.liabilities_equity_total],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Balance Sheet</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">as of</div>
            <DateInput value={asOf} onChange={e => setAsOf(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <DownloadButtons headers={dlHeaders} getRows={dlRows} filename={`balance-sheet-${asOf}`} title={`Balance Sheet — ${asOf}`} />
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

      <ReportCard companyName={bizName} title="Balance Sheet" subtitle={`As of ${fmtLongDate(asOf)}`}>
        <div className="w-full overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b">
              <td colSpan={2} className="p-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Assets</td>
            </tr>
            {report.asset_lines.length === 0 && (
              <tr className="border-b"><td colSpan={2} className="p-3 pl-8 text-muted-foreground">No asset balances.</td></tr>
            )}
            {report.asset_lines.map(l => (
              <tr key={l.account_id} className="border-b hover:bg-muted/30">
                <td className="p-3 pl-8"><span className="mr-3 font-mono text-muted-foreground">{l.account_code}</span>{l.account_name}</td>
                <td className="p-3 text-right font-mono">{fmtMoney(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-b font-semibold">
              <td className="p-3">Total Assets</td>
              <td className="p-3 text-right font-mono">{fmtMoney(report.assets_total)}</td>
            </tr>

            <tr className="border-b">
              <td colSpan={2} className="p-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Liabilities</td>
            </tr>
            {report.liability_lines.length === 0 && (
              <tr className="border-b"><td colSpan={2} className="p-3 pl-8 text-muted-foreground">No liability balances.</td></tr>
            )}
            {report.liability_lines.map(l => (
              <tr key={l.account_id} className="border-b hover:bg-muted/30">
                <td className="p-3 pl-8"><span className="mr-3 font-mono text-muted-foreground">{l.account_code}</span>{l.account_name}</td>
                <td className="p-3 text-right font-mono">{fmtMoney(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-b font-semibold">
              <td className="p-3">Total Liabilities</td>
              <td className="p-3 text-right font-mono">{fmtMoney(report.liabilities_total)}</td>
            </tr>

            <tr className="border-b">
              <td colSpan={2} className="p-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Equity</td>
            </tr>
            {report.equity_lines.map(l => (
              <tr key={l.account_id} className="border-b hover:bg-muted/30">
                <td className="p-3 pl-8"><span className="mr-3 font-mono text-muted-foreground">{l.account_code}</span>{l.account_name}</td>
                <td className="p-3 text-right font-mono">{fmtMoney(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-b hover:bg-muted/30">
              <td className="p-3 pl-8 italic">Net Income YTD</td>
              <td className="p-3 text-right font-mono">{fmtMoney(report.net_income_ytd)}</td>
            </tr>
            <tr className="border-b font-semibold">
              <td className="p-3">Total Equity + Net Income</td>
              <td className="p-3 text-right font-mono">{fmtMoney(equityPlusNi)}</td>
            </tr>

            <tr className="font-semibold">
              <td className="p-3">TOTAL LIABILITIES AND EQUITY</td>
              <td className="p-3 text-right font-mono">{fmtMoney(report.liabilities_equity_total)}</td>
            </tr>
          </tbody>
        </table>
        </div>
      </ReportCard>
    </div>
  );
}
