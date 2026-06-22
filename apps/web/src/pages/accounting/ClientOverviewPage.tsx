import { useEffect, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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

export default function ClientOverviewPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [, setActiveBusiness] = useActiveBusinessId();
  const [rows, setRows] = useState<FirmRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  function pickBusiness(id: string) {
    setActiveBusiness(id);
    navigate('/');
  }

  const dlHeaders = ['Business', 'AR Balance', 'AP Balance', 'Unreviewed Bank Txns', 'Open Periods', 'Last Reconciliation'];
  const dlRows = () => rows.map(r => [
    r.business_name,
    r.ar_balance,
    r.ap_balance,
    String(r.unreviewed_bank_txn_count),
    String(r.open_period_count),
    r.last_reconciliation_date ?? '—',
  ]);

  const [excelBusy, setExcelBusy] = useState(false);

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

      <Card>
        <CardHeader>
          <CardTitle>All clients</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No businesses in this firm yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left">Business</th>
                  <th className="px-3 py-2 text-right">AR Balance</th>
                  <th className="px-3 py-2 text-right">AP Balance</th>
                  <th className="px-3 py-2 text-right">Unreviewed Bank Txns</th>
                  <th className="px-3 py-2 text-right">Open Periods</th>
                  <th className="px-3 py-2 text-right">Last Reconciliation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.business_id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => pickBusiness(r.business_id)}
                        className="text-primary underline hover:no-underline"
                      >
                        {r.business_name}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.ar_balance)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.ap_balance)}</td>
                    <td className="px-3 py-2 text-right">{r.unreviewed_bank_txn_count}</td>
                    <td className="px-3 py-2 text-right">{r.open_period_count}</td>
                    <td className="px-3 py-2 text-right">
                      {r.last_reconciliation_date && r.last_reconciliation_date !== '' ? r.last_reconciliation_date : '—'}
                    </td>
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
