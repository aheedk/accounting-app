import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { fmtMoney } from '@/lib/money';

type CreditMemoSummary = { id: string; memo_date: string; status: string; amount: string; remaining_amount: string };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function CreditMemoListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<CreditMemoSummary[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/credit-memos`).then(r => setItems(r.data.credit_memos)); }, [bizId]);

  const columns: Column<CreditMemoSummary>[] = [
    { key: 'memo_date', header: 'Date', sortable: true, sortValue: r => Date.parse(r.memo_date), render: r => <span className="whitespace-nowrap">{fmtShortDate(r.memo_date)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => <span className="capitalize">{r.status}</span> },
    { key: 'amount', header: 'Amount', sortable: true, align: 'right', sortValue: r => Number(r.amount), render: r => <span className="font-mono">{fmtMoney(r.amount)}</span> },
    { key: 'remaining_amount', header: 'Remaining', sortable: true, align: 'right', sortValue: r => Number(r.remaining_amount), render: r => <span className="font-mono">{fmtMoney(r.remaining_amount)}</span> },
  ];

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Credit Memos</h1>
        <Button asChild><Link to="/credit-memos/new">New credit memo</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <DataTable
          rows={items}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="memo_date"
          defaultSortDir="desc"
          downloadable={{ filename: 'credit-memos', title: 'Credit Memos' }}
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/credit-memos/${r.id}`}>View/Edit</Link>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage="No credit memos."
        />
      </CardContent></Card>
    </div>
  );
}
