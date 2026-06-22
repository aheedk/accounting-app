import { useEffect, useMemo, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MoneyBar } from '@/components/ui/MoneyBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from '@/lib/business';
import { api } from '@/lib/apiClient';
import { fmtMoney } from '@/lib/money';
import { downloadAsExcel } from '@/lib/download';

type FirmRow = {
  business_id: string;
  business_name: string;
  ar_balance: string;
  ap_balance: string;
  unreviewed_bank_txn_count: number;
  open_period_count: number;
  last_reconciliation_date: string | null;
};

function fmtShortDate(iso: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function ClientOverviewPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [, setActiveBusiness] = useActiveBusinessId();
  const [rows, setRows] = useState<FirmRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const isFirmAdmin = user?.role === 'firm_admin';

  useEffect(() => {
    if (!isFirmAdmin) return;
    setRows(null);
    setError(null);
    api
      .get<{ businesses: FirmRow[] }>('/firm-overview')
      .then(r => setRows(r.data.businesses))
      .catch((e: unknown) => {
        const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
        setError(msg ?? (e instanceof Error ? e.message : 'Failed to load firm overview'));
      });
  }, [isFirmAdmin]);

  const totals = useMemo(() => (rows ?? []).reduce(
    (acc, r) => ({ ar: acc.ar + Number(r.ar_balance), ap: acc.ap + Number(r.ap_balance) }),
    { ar: 0, ap: 0 },
  ), [rows]);

  function pickBusiness(id: string) {
    setActiveBusiness(id);
    navigate('/');
  }

  const columns: Column<FirmRow>[] = [
    {
      key: 'business_name', header: 'Business', sortable: true, sortValue: r => r.business_name,
      render: r => (
        <button type="button" onClick={() => pickBusiness(r.business_id)} className="font-medium text-primary hover:underline">
          {r.business_name}
        </button>
      ),
    },
    { key: 'ar_balance', header: 'AR Balance', align: 'right', sortable: true, sortValue: r => Number(r.ar_balance), render: r => <span className="font-mono">{fmtMoney(r.ar_balance)}</span> },
    { key: 'ap_balance', header: 'AP Balance', align: 'right', sortable: true, sortValue: r => Number(r.ap_balance), render: r => <span className="font-mono">{fmtMoney(r.ap_balance)}</span> },
    { key: 'unreviewed_bank_txn_count', header: 'Unreviewed Txns', align: 'right', sortable: true, sortValue: r => r.unreviewed_bank_txn_count, render: r => r.unreviewed_bank_txn_count > 0 ? <span className="font-medium text-amber-700">{r.unreviewed_bank_txn_count}</span> : <span className="text-muted-foreground">0</span> },
    { key: 'open_period_count', header: 'Open Periods', align: 'right', sortable: true, sortValue: r => r.open_period_count, render: r => r.open_period_count },
    { key: 'last_reconciliation_date', header: 'Last Reconciliation', align: 'right', sortable: true, sortValue: r => r.last_reconciliation_date ?? '', render: r => <span className="whitespace-nowrap">{fmtShortDate(r.last_reconciliation_date)}</span> },
  ];

  if (!isFirmAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Client Overview</h1>
        <p className="text-sm text-muted-foreground">This view is for firm administrators only.</p>
        <Button onClick={() => navigate('/')}>Back to dashboard</Button>
      </div>
    );
  }

  if (error) return <div className="text-sm text-destructive">{error}</div>;
  if (!rows) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const dlHeaders = ['Business', 'AR Balance', 'AP Balance', 'Unreviewed Bank Txns', 'Open Periods', 'Last Reconciliation'];
  const dlRows = () => rows.map(r => [
    r.business_name,
    r.ar_balance,
    r.ap_balance,
    String(r.unreviewed_bank_txn_count),
    String(r.open_period_count),
    r.last_reconciliation_date ?? '—',
  ]);

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'client-overview'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Client Overview</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Client Overview</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Client Overview</h1>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handleExport} disabled={excelBusy} aria-label="Export to Excel">
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
          </div>
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={handlePrint} aria-label="Print">
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <MoneyBar
          segments={[
            { amount: totals.ar, caption: 'Total receivable', colorClass: 'bg-emerald-500' },
            { amount: totals.ap, caption: 'Total payable', colorClass: 'bg-rose-500' },
            { amount: totals.ar - totals.ap, caption: 'Net position', colorClass: 'bg-sky-500' },
          ]}
        />
      )}

      <Card><CardContent className="p-0">
        <DataTable
          rows={rows}
          getRowId={r => r.business_id}
          columns={columns}
          defaultSortKey="business_name"
          defaultSortDir="asc"
          selectable={false}
          downloadable={{ filename: 'client-overview', title: 'Client Overview' }}
          emptyMessage={<EmptyState title="No businesses in this firm yet" hint="Clients you add to the firm will appear here with their balances and review status." />}
        />
      </CardContent></Card>
    </div>
  );
}
