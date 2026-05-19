import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { fmtMoney } from '@/lib/money';

type BillPaymentSummary = { id: string; payment_date: string; payment_method: string; status: string; amount: string; unapplied_amount: string };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function BillPaymentListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<BillPaymentSummary[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/bill-payments`).then(r => setItems(r.data.bill_payments)); }, [bizId]);

  const columns: Column<BillPaymentSummary>[] = [
    { key: 'payment_date', header: 'Date', sortable: true, sortValue: r => Date.parse(r.payment_date), render: r => <span className="whitespace-nowrap">{fmtShortDate(r.payment_date)}</span> },
    { key: 'payment_method', header: 'Method', sortable: true, sortValue: r => r.payment_method, render: r => <span className="capitalize">{r.payment_method}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => <span className="capitalize">{r.status}</span> },
    { key: 'amount', header: 'Amount', sortable: true, align: 'right', sortValue: r => Number(r.amount), render: r => <span className="font-mono">{fmtMoney(r.amount)}</span> },
    { key: 'unapplied_amount', header: 'Unapplied', sortable: true, align: 'right', sortValue: r => Number(r.unapplied_amount), render: r => <span className="font-mono">{fmtMoney(r.unapplied_amount)}</span> },
  ];

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bill Payments</h1>
        <Button asChild><Link to="/ap/bill-payments/new">Record payment</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <DataTable
          rows={items}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="payment_date"
          defaultSortDir="desc"
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/ap/bill-payments/${r.id}`}>View/Edit</Link>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage="No bill payments."
        />
      </CardContent></Card>
    </div>
  );
}
