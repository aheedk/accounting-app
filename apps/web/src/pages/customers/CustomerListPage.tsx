import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { fmtMoney } from '@/lib/money';
import { UploadExcelButton } from '@/components/ui/UploadExcelButton';

const IMPORT_COLS = [
  { key: 'name', header: 'Name', required: true },
  { key: 'company_name', header: 'Company Name' },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'default_terms_days', header: 'Terms Days' },
];

type Customer = {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  default_terms_days: number;
  open_balance: string | null;
};

export default function CustomerListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<Customer[]>([]);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/customers`);
    setItems(r.data.customers);
  }

  useEffect(() => { reload(); }, [bizId]);

  const columns: Column<Customer>[] = [
    { key: 'name', header: 'Name', sortable: true, sortValue: r => r.name, render: r => <Link className="font-medium hover:underline" to={`/customers/${r.id}`}>{r.name}</Link> },
    { key: 'company_name', header: 'Company name', sortable: true, sortValue: r => r.company_name ?? '', render: r => r.company_name || <span className="text-muted-foreground">—</span> },
    { key: 'phone', header: 'Phone', render: r => <span className="whitespace-nowrap">{r.phone || <span className="text-muted-foreground">—</span>}</span> },
    { key: 'open_balance', header: 'Open balance', sortable: true, align: 'right', sortValue: r => Number(r.open_balance ?? 0), render: r => <span className="font-mono">{fmtMoney((r.open_balance ?? '0').toString())}</span> },
  ];

  async function importRow(row: Record<string, string>) {
    await api.post(`/businesses/${bizId}/customers`, {
      name: row['name'],
      company_name: row['company_name'] || null,
      email: row['email'] || null,
      phone: row['phone'] || null,
      default_terms_days: row['default_terms_days'] ? parseInt(row['default_terms_days'], 10) : undefined,
    });
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <div className="flex items-center gap-2">
          <UploadExcelButton columns={IMPORT_COLS} entityName="Customers" onImportRow={importRow} onDone={reload} />
          <Button asChild><Link to="/customers/new">New customer</Link></Button>
        </div>
      </div>
      <Card><CardContent className="p-0">
        <DataTable
          rows={items}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="name"
          defaultSortDir="asc"
          downloadable={{ filename: 'customers', title: 'Customers' }}
          actions={r => {
            const hasBalance = Number(r.open_balance ?? 0) > 0;
            return (
              <span className="inline-flex items-center gap-2">
                {hasBalance
                  ? <Link className="text-primary hover:underline" to={`/payments/new?customer_id=${r.id}`}>Receive payment</Link>
                  : <Link className="text-primary hover:underline" to={`/invoices/new?customer_id=${r.id}`}>Create invoice</Link>}
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </span>
            );
          }}
          emptyMessage="No customers."
        />
      </CardContent></Card>
    </div>
  );
}
