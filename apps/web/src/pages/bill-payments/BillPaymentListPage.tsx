import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type BillPaymentSummary = { id: string; payment_date: string; payment_method: string; status: string; amount: string; unapplied_amount: string };

export default function BillPaymentListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<BillPaymentSummary[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/bill-payments`).then(r => setItems(r.data.bill_payments)); }, [bizId]);
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bill Payments</h1>
        <Button asChild><Link to="/ap/bill-payments/new">Record payment</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Method</th><th className="text-left p-3">Status</th><th className="text-right p-3">Amount</th><th className="text-right p-3">Unapplied</th><th></th></tr></thead>
          <tbody>{items.map(p => (
            <tr key={p.id} className="border-b last:border-b-0">
              <td className="p-3">{p.payment_date}</td>
              <td className="p-3">{p.payment_method}</td>
              <td className="p-3">{p.status}</td>
              <td className="p-3 text-right">{fmtMoney(p.amount)}</td>
              <td className="p-3 text-right">{fmtMoney(p.unapplied_amount)}</td>
              <td className="p-3"><Link className="text-primary underline" to={`/ap/bill-payments/${p.id}`}>view</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
