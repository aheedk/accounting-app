import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Vendor = { id: string; name: string; email: string | null; default_terms_days: number; is_1099: boolean };

export default function VendorListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<Vendor[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/vendors`).then(r => setItems(r.data.vendors)); }, [bizId]);
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vendors</h1>
        <Button asChild><Link to="/ap/vendors/new">New vendor</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Name</th><th className="text-left p-3">Email</th><th className="text-left p-3">Terms</th><th className="text-left p-3">1099</th><th></th></tr></thead>
          <tbody>{items.map(v => (
            <tr key={v.id} className="border-b last:border-b-0">
              <td className="p-3">{v.name}</td>
              <td className="p-3">{v.email ?? ''}</td>
              <td className="p-3">{v.default_terms_days}d</td>
              <td className="p-3">
                {v.is_1099 ? (
                  <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Yes</span>
                ) : (
                  <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">No</span>
                )}
              </td>
              <td className="p-3"><Link className="text-primary underline" to={`/ap/vendors/${v.id}`}>view</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
