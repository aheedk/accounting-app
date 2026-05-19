import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';

type Vendor = { id: string; name: string; email: string | null; default_terms_days: number; is_1099: boolean };

export default function VendorListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<Vendor[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/vendors`).then(r => setItems(r.data.vendors)); }, [bizId]);

  const columns: Column<Vendor>[] = [
    { key: 'name', header: 'Name', sortable: true, sortValue: r => r.name, render: r => <Link className="font-medium hover:underline" to={`/ap/vendors/${r.id}`}>{r.name}</Link> },
    { key: 'email', header: 'Email', sortable: true, sortValue: r => r.email ?? '', render: r => r.email || <span className="text-muted-foreground">—</span> },
    { key: 'default_terms_days', header: 'Terms', sortable: true, sortValue: r => r.default_terms_days, render: r => <span className="whitespace-nowrap">{r.default_terms_days}d</span> },
    {
      key: 'is_1099',
      header: '1099',
      sortable: true,
      sortValue: r => (r.is_1099 ? 1 : 0),
      render: r => r.is_1099
        ? <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Yes</span>
        : <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">No</span>,
    },
  ];

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vendors</h1>
        <Button asChild><Link to="/ap/vendors/new">New vendor</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <DataTable
          rows={items}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="name"
          defaultSortDir="asc"
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/ap/bills/new?vendor_id=${r.id}`}>Create bill</Link>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage="No vendors."
        />
      </CardContent></Card>
    </div>
  );
}
