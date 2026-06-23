import { useEffect, useMemo, useState } from 'react';
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Client Overview</h1>

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
