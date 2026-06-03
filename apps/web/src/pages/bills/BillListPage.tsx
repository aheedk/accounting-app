import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { fmtMoney } from '@/lib/money';

type BillSummary = { id: string; bill_number: string; vendor_id: string; bill_date: string; due_date: string; status: string; total: string };
type Vendor = { id: string; name: string };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function BillListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<BillSummary[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/bills`, { params: statusFilter ? { status: statusFilter } : {} }).then(r => setItems(r.data.bills));
  }, [bizId, statusFilter]);
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/vendors`).then(r => setVendors(r.data.vendors));
  }, [bizId]);

  const vendorMap = useMemo(() => new Map(vendors.map(v => [v.id, v.name])), [vendors]);

  type Row = BillSummary & { vendor_name: string };
  const rows: Row[] = useMemo(
    () => items.map(b => ({ ...b, vendor_name: vendorMap.get(b.vendor_id) ?? '' })),
    [items, vendorMap],
  );

  const columns: Column<Row>[] = [
    { key: 'bill_date', header: 'Bill Date', sortable: true, sortValue: r => Date.parse(r.bill_date), render: r => <span className="whitespace-nowrap">{fmtShortDate(r.bill_date)}</span> },
    { key: 'bill_number', header: 'Bill #', sortable: true, sortValue: r => r.bill_number, render: r => <span className="font-mono">{r.bill_number}</span> },
    { key: 'vendor', header: 'Vendor', sortable: true, sortValue: r => r.vendor_name, render: r => r.vendor_name || <span className="text-muted-foreground">—</span> },
    { key: 'due_date', header: 'Due', sortable: true, sortValue: r => Date.parse(r.due_date), render: r => <span className="whitespace-nowrap">{fmtShortDate(r.due_date)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => <span className="capitalize">{r.status}</span> },
    { key: 'total', header: 'Total', sortable: true, align: 'right', sortValue: r => Number(r.total), render: r => <span className="font-mono">{fmtMoney(r.total)}</span> },
  ];

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bills</h1>
        <div className="flex items-center gap-3">
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>{['draft', 'posted', 'paid', 'voided'].map(s => <option key={s}>{s}</option>)}
          </select>
          <Button asChild><Link to="/ap/bills/new">New bill</Link></Button>
        </div>
      </div>
      <Card><CardContent className="p-0">
        <DataTable
          rows={rows}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="bill_date"
          defaultSortDir="desc"
          downloadable={{ filename: 'bills', title: 'Bills' }}
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/ap/bills/${r.id}`}>View/Edit</Link>
              {r.status === 'posted' && (
                <>
                  <span className="text-muted-foreground/50">|</span>
                  <Link className="text-primary hover:underline" to={`/ap/bill-payments/new?vendor_id=${r.vendor_id}&bill_id=${r.id}`}>Pay bill</Link>
                </>
              )}
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage="No bills."
        />
      </CardContent></Card>
    </div>
  );
}
