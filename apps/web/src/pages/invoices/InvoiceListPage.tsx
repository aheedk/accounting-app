import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type InvoiceSummary = { id: string; invoice_number: string; issue_date: string; due_date: string; status: string; total: string };

export default function InvoiceListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<InvoiceSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/invoices`, { params: statusFilter ? { status: statusFilter } : {} }).then(r => setItems(r.data.invoices));
  }, [bizId, statusFilter]);
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <div className="flex items-center gap-3">
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>{['draft','posted','paid','voided'].map(s => <option key={s}>{s}</option>)}
          </select>
          <Button asChild><Link to="/invoices/new">New invoice</Link></Button>
        </div>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">#</th><th className="text-left p-3">Invoice date</th><th className="text-left p-3">Due</th><th className="text-left p-3">Status</th><th className="text-right p-3">Total</th><th></th></tr></thead>
          <tbody>{items.map(i => (
            <tr key={i.id} className="border-b last:border-b-0">
              <td className="p-3 font-mono">{i.invoice_number}</td>
              <td className="p-3">{i.issue_date}</td>
              <td className="p-3">{i.due_date}</td>
              <td className="p-3">{i.status}</td>
              <td className="p-3 text-right">{fmtMoney(i.total)}</td>
              <td className="p-3"><Link className="text-primary underline" to={`/invoices/${i.id}`}>view</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
