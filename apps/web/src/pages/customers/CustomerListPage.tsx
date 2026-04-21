import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type C = { id: string; name: string; email: string | null; default_terms_days: number };

export default function CustomerListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<C[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/customers`).then(r => setItems(r.data.customers)); }, [bizId]);
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <Button asChild><Link to="/customers/new">New customer</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Name</th><th className="text-left p-3">Email</th><th className="text-left p-3">Terms</th><th></th></tr></thead>
          <tbody>{items.map(c => (
            <tr key={c.id} className="border-b last:border-b-0">
              <td className="p-3">{c.name}</td>
              <td className="p-3">{c.email ?? ''}</td>
              <td className="p-3">{c.default_terms_days}d</td>
              <td className="p-3"><Link className="text-primary underline" to={`/customers/${c.id}`}>view</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
