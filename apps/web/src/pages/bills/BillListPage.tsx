import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type BillSummary = { id: string; bill_number: string; vendor_id: string; bill_date: string; due_date: string; status: string; total: string };
type Vendor = { id: string; name: string };

export default function BillListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<BillSummary[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/bills`, { params: statusFilter ? { status: statusFilter } : {} }).then(r => setItems(r.data.bills));
    api.get(`/businesses/${bizId}/vendors`).then(r => setVendors(r.data.vendors));
  }, [bizId, statusFilter]);
  if (!bizId) return <div>Pick a business.</div>;
  const vendorMap = new Map(vendors.map(v => [v.id, v.name]));
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bills</h1>
        <div className="flex items-center gap-3">
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>{['draft','posted','paid','voided'].map(s => <option key={s}>{s}</option>)}
          </select>
          <Button asChild><Link to="/ap/bills/new">New bill</Link></Button>
        </div>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Bill #</th><th className="text-left p-3">Vendor</th><th className="text-left p-3">Bill Date</th><th className="text-left p-3">Due</th><th className="text-left p-3">Status</th><th className="text-right p-3">Total</th><th></th></tr></thead>
          <tbody>{items.map(b => (
            <tr key={b.id} className="border-b last:border-b-0">
              <td className="p-3 font-mono">{b.bill_number}</td>
              <td className="p-3">{vendorMap.get(b.vendor_id) ?? '—'}</td>
              <td className="p-3">{b.bill_date}</td>
              <td className="p-3">{b.due_date}</td>
              <td className="p-3">{b.status}</td>
              <td className="p-3 text-right">{fmtMoney(b.total)}</td>
              <td className="p-3"><Link className="text-primary underline" to={`/ap/bills/${b.id}`}>view</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
