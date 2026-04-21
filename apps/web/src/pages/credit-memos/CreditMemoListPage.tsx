import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type CreditMemoSummary = { id: string; memo_date: string; status: string; amount: string; remaining_amount: string };

export default function CreditMemoListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<CreditMemoSummary[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/credit-memos`).then(r => setItems(r.data.credit_memos)); }, [bizId]);
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Credit Memos</h1><Button asChild><Link to="/credit-memos/new">New credit memo</Link></Button></div>
      <Card><CardContent className="p-0"><table className="w-full text-sm">
        <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Status</th><th className="text-right p-3">Amount</th><th className="text-right p-3">Remaining</th><th></th></tr></thead>
        <tbody>{items.map(c => (<tr key={c.id} className="border-b last:border-b-0">
          <td className="p-3">{c.memo_date}</td><td className="p-3">{c.status}</td>
          <td className="p-3 text-right">{fmtMoney(c.amount)}</td><td className="p-3 text-right">{fmtMoney(c.remaining_amount)}</td>
          <td className="p-3"><Link className="text-primary underline" to={`/credit-memos/${c.id}`}>view</Link></td>
        </tr>))}</tbody>
      </table></CardContent></Card>
    </div>
  );
}
