import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type VendorCreditSummary = { id: string; credit_date: string; status: string; amount: string; remaining_amount: string };

export default function VendorCreditListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<VendorCreditSummary[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/vendor-credits`).then(r => setItems(r.data.vendor_credits)); }, [bizId]);
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Vendor Credits</h1><Button asChild><Link to="/ap/vendor-credits/new">New vendor credit</Link></Button></div>
      <Card><CardContent className="p-0"><table className="w-full text-sm">
        <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Status</th><th className="text-right p-3">Amount</th><th className="text-right p-3">Remaining</th><th></th></tr></thead>
        <tbody>{items.map(c => (<tr key={c.id} className="border-b last:border-b-0">
          <td className="p-3">{c.credit_date}</td><td className="p-3">{c.status}</td>
          <td className="p-3 text-right">{fmtMoney(c.amount)}</td><td className="p-3 text-right">{fmtMoney(c.remaining_amount)}</td>
          <td className="p-3"><Link className="text-primary underline" to={`/ap/vendor-credits/${c.id}`}>view</Link></td>
        </tr>))}</tbody>
      </table></CardContent></Card>
    </div>
  );
}
