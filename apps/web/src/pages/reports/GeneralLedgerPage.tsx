import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, Printer } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { ReportCard } from '@/components/ui/ReportCard';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { dateToLocalIso, fmtLongDate } from '@/lib/dates';
import { downloadAsExcel } from '@/lib/download';
import { fmtMoney, fmtSigned } from '@/lib/money';

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
};

type GeneralLedgerLine = {
  journal_entry_id: string;
  line_id: string;
  entry_date: string;
  source_type: string;
  reference: string | null;
  memo: string | null;
  status: 'posted' | 'voided';
  debit: string;
  credit: string;
  running_balance: string;
};

type GeneralLedgerAccount = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  normal_balance: 'debit' | 'credit';
  beginning_balance: string;
  total_debit: string;
  total_credit: string;
  ending_balance: string;
  lines: GeneralLedgerLine[];
};

type GeneralLedgerReport = {
  period_start: string;
  period_end: string;
  account_id: string | null;
  accounts: GeneralLedgerAccount[];
  totals: { total_debit: string; total_credit: string };
};

function currentMonthRange(): { start: string; end: string } {
  const today = new Date();
  return {
    start: dateToLocalIso(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: dateToLocalIso(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
  };
}

function fmtShortDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${Number(month)}/${Number(day)}/${year.slice(2)}`;
}

function fmtSource(source: string): string {
  return source.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function pickErr(error: unknown): string {
  return (error as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed to load the General Ledger report';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const exportHeaders = ['Account Code', 'Account', 'Date', 'Transaction Type', 'Reference', 'Memo', 'Debit', 'Credit', 'Balance'];

function exportRows(report: GeneralLedgerReport): string[][] {
  const rows: string[][] = [];
  for (const account of report.accounts) {
    rows.push([
      account.account_code, account.account_name, '', 'Beginning Balance', '', '', '', '', account.beginning_balance,
    ]);
    for (const line of account.lines) {
      rows.push([
        account.account_code,
        account.account_name,
        line.entry_date,
        `${fmtSource(line.source_type)}${line.status === 'voided' ? ' (Voided)' : ''}`,
        line.reference ?? '',
        line.memo ?? '',
        line.debit,
        line.credit,
        line.running_balance,
      ]);
    }
    rows.push([
      account.account_code, account.account_name, '', 'Account Total', '', '', account.total_debit, account.total_credit, account.ending_balance,
    ]);
  }
  rows.push(['', 'REPORT TOTAL', '', '', '', '', report.totals.total_debit, report.totals.total_credit, '']);
  return rows;
}

export default function GeneralLedgerPage() {
  const [businessId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const businessName = businesses.find(business => business.id === businessId)?.name ?? '';
  const defaults = currentMonthRange();
  const [periodStart, setPeriodStart] = useState(defaults.start);
  const [periodEnd, setPeriodEnd] = useState(defaults.end);
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [report, setReport] = useState<GeneralLedgerReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    setAccountId('');
    api.get<{ accounts: Account[] }>(`/businesses/${businessId}/coa`, { params: { include_inactive: 'true' } })
      .then(response => setAccounts(response.data.accounts))
      .catch(() => setAccounts([]));
  }, [businessId]);

  const load = useCallback(async (): Promise<void> => {
    if (!businessId) return;
    if (periodStart > periodEnd) {
      setError('Period end must be on or after period start');
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<GeneralLedgerReport>(`/businesses/${businessId}/reports/general-ledger`, {
        params: {
          period_start: periodStart,
          period_end: periodEnd,
          ...(accountId ? { account_id: accountId } : {}),
        },
      });
      setReport(response.data);
    } catch (requestError: unknown) {
      setError(pickErr(requestError));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [accountId, businessId, periodEnd, periodStart]);

  useEffect(() => { void load(); }, [load]);

  const rowsForExport = useMemo(() => report ? exportRows(report) : [], [report]);

  function handleExport(): void {
    if (!report) return;
    setExporting(true);
    try {
      downloadAsExcel(exportHeaders, rowsForExport, `general-ledger-${report.period_start}-to-${report.period_end}`);
    } finally {
      setExporting(false);
    }
  }

  function handlePrint(): void {
    if (!report) return;
    const body = rowsForExport.map(row => (
      `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
    )).join('');
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>General Ledger</title><style>body{font-family:Arial,sans-serif;font-size:10px;margin:24px}h2{margin:0 0 4px;text-align:center}p{color:#666;margin:0 0 16px;text-align:center}table{width:100%;border-collapse:collapse}th{background:#eee;text-align:left;padding:5px;border-bottom:2px solid #bbb}td{padding:4px 5px;border-bottom:1px solid #ddd}th:nth-last-child(-n+3),td:nth-last-child(-n+3){text-align:right}</style></head><body><h2>${escapeHtml(businessName)} — General Ledger</h2><p>${escapeHtml(fmtLongDate(report.period_start))} – ${escapeHtml(fmtLongDate(report.period_end))}</p><table><thead><tr>${exportHeaders.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`);
    printWindow.document.close();
  }

  if (!businessId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">General Ledger</h1>
          <p className="mt-1 text-sm text-muted-foreground">Detailed activity and running balance for every ledger account.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Period start</div>
            <DateInput value={periodStart} onChange={event => setPeriodStart(event.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Period end</div>
            <DateInput value={periodEnd} onChange={event => setPeriodEnd(event.target.value)} />
          </div>
          <div className="min-w-[16rem]">
            <div className="mb-1 text-xs text-muted-foreground">Account</div>
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={accountId}
              onChange={event => setAccountId(event.target.value)}
            >
              <option value="">All accounts</option>
              {accounts.map(account => (
                <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
              ))}
            </select>
          </div>
          <Button variant="outline" onClick={() => { void load(); }} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <div className="relative group">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              onClick={handleExport}
              disabled={!report || exporting}
              aria-label="Export to Excel"
            >
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
          </div>
          <div className="relative group">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              onClick={handlePrint}
              disabled={!report}
              aria-label="Print"
            >
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
          </div>
        </div>
      </div>

      {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      {report && (
        <ReportCard
          companyName={businessName}
          title="General Ledger"
          subtitle={`${fmtLongDate(report.period_start)} – ${fmtLongDate(report.period_end)}`}
        >
          {report.accounts.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No ledger activity was found for this period.</div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="border-b">
                  <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="p-3 text-left">Date</th>
                    <th className="p-3 text-left">Transaction</th>
                    <th className="p-3 text-left">Reference</th>
                    <th className="p-3 text-left">Memo</th>
                    <th className="p-3 text-right">Debit</th>
                    <th className="p-3 text-right">Credit</th>
                    <th className="p-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {report.accounts.map(account => (
                    <AccountSection key={account.account_id} account={account} />
                  ))}
                  <tr className="border-t-2 font-semibold">
                    <td colSpan={4} className="p-3">REPORT TOTAL</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(report.totals.total_debit)}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(report.totals.total_credit)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </ReportCard>
      )}
    </div>
  );
}

function AccountSection({ account }: { account: GeneralLedgerAccount }) {
  return (
    <>
      <tr className="border-y bg-muted/50">
        <td colSpan={7} className="p-3 font-semibold">
          <span className="mr-3 font-mono text-muted-foreground">{account.account_code}</span>
          {account.account_name}
          <span className="ml-2 text-xs font-normal capitalize text-muted-foreground">
            {account.account_type} · {account.normal_balance}-normal
          </span>
        </td>
      </tr>
      <tr className="border-b text-muted-foreground">
        <td className="p-3" />
        <td colSpan={3} className="p-3">Beginning Balance</td>
        <td />
        <td />
        <td className="p-3 text-right font-mono">{fmtSigned(account.beginning_balance)}</td>
      </tr>
      {account.lines.length === 0 && (
        <tr className="border-b"><td colSpan={7} className="p-3 pl-8 text-muted-foreground">No activity in this period.</td></tr>
      )}
      {account.lines.map(line => (
        <tr key={line.line_id} className={`border-b hover:bg-muted/30 ${line.status === 'voided' ? 'text-muted-foreground' : ''}`}>
          <td className="whitespace-nowrap p-3">{fmtShortDate(line.entry_date)}</td>
          <td className="p-3">
            <Link className="font-medium text-primary hover:underline" to={`/journal/${line.journal_entry_id}`}>
              {fmtSource(line.source_type)}
            </Link>
            {line.status === 'voided' && <span className="ml-2 text-xs uppercase">Voided</span>}
          </td>
          <td className="p-3 font-mono text-xs">{line.reference ?? '—'}</td>
          <td className="max-w-[22rem] truncate p-3" title={line.memo ?? undefined}>{line.memo ?? '—'}</td>
          <td className="p-3 text-right font-mono">{line.debit === '0.0000' ? '' : fmtMoney(line.debit)}</td>
          <td className="p-3 text-right font-mono">{line.credit === '0.0000' ? '' : fmtMoney(line.credit)}</td>
          <td className="p-3 text-right font-mono">{fmtSigned(line.running_balance)}</td>
        </tr>
      ))}
      <tr className="border-b-2 font-semibold">
        <td />
        <td colSpan={3} className="p-3">Total for {account.account_code} — {account.account_name}</td>
        <td className="p-3 text-right font-mono">{fmtMoney(account.total_debit)}</td>
        <td className="p-3 text-right font-mono">{fmtMoney(account.total_credit)}</td>
        <td className="p-3 text-right font-mono">{fmtSigned(account.ending_balance)}</td>
      </tr>
    </>
  );
}
