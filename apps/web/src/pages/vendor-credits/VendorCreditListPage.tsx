import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { fmtMoney } from '@/lib/money';

type VendorCreditSummary = { id: string; credit_date: string; status: string; amount: string; remaining_amount: string };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function VendorCreditListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<VendorCreditSummary[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/vendor-credits`).then(r => setItems(r.data.vendor_credits)); }, [bizId]);

  const columns: Column<VendorCreditSummary>[] = [
    { key: 'credit_date', header: 'Date', sortable: true, sortValue: r => Date.parse(r.credit_date), render: r => <span className="whitespace-nowrap">{fmtShortDate(r.credit_date)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => <span className="capitalize">{r.status}</span> },
    { key: 'amount', header: 'Amount', sortable: true, align: 'right', sortValue: r => Number(r.amount), render: r => <span className="font-mono">{fmtMoney(r.amount)}</span> },
    { key: 'remaining_amount', header: 'Remaining', sortable: true, align: 'right', sortValue: r => Number(r.remaining_amount), render: r => <span className="font-mono">{fmtMoney(r.remaining_amount)}</span> },
  ];

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vendor Credits</h1>
        <Button asChild><Link to="/ap/vendor-credits/new">New vendor credit</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <DataTable
          rows={items}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="credit_date"
          defaultSortDir="desc"
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/ap/vendor-credits/${r.id}`}>View/Edit</Link>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage="No vendor credits."
        />
      </CardContent></Card>
    </div>
  );
}
