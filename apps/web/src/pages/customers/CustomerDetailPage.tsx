import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type Customer = { id: string; name: string; company_name: string | null; email: string | null; phone: string | null; default_terms_days: number };
type InvoiceSummary = { id: string; invoice_number: string; issue_date: string; due_date: string; status: string; total: string };

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  useEffect(() => {
    if (!bizId || !id) return;
    api.get(`/businesses/${bizId}/customers/${id}`).then(r => setCustomer(r.data));
    api.get(`/businesses/${bizId}/invoices`, { params: { customer_id: id } }).then(r => setInvoices(r.data.invoices));
  }, [bizId, id]);
  if (!customer) return <div>Loading…</div>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{customer.name}</h1>
      <Card><CardHeader><CardTitle>Contact</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <div>Company: {customer.company_name ?? '—'}</div>
          <div>Email: {customer.email ?? '—'}</div>
          <div>Phone: {customer.phone ?? '—'}</div>
          <div>Terms: {customer.default_terms_days}d</div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">#</th><th className="text-left p-3">Date</th><th className="text-left p-3">Status</th><th className="text-right p-3">Total</th><th></th></tr></thead>
            <tbody>{invoices.map((i: InvoiceSummary) => (
              <tr key={i.id} className="border-b last:border-b-0">
                <td className="p-3 font-mono">{i.invoice_number}</td>
                <td className="p-3">{i.issue_date}</td>
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
