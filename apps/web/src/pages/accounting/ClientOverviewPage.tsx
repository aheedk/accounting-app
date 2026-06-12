import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from '@/lib/business';
import { api } from '@/lib/apiClient';
import { DownloadButtons } from '@/components/ui/DownloadButtons';
import { fmtMoney } from '@/lib/money';

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Client Overview</h1>
        <DownloadButtons headers={dlHeaders} getRows={dlRows} filename="client-overview" title="Client Overview" />
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
