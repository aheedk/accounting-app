import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { fmtMoney } from '@/lib/money';
import { UploadExcelButton } from '@/components/ui/UploadExcelButton';
import { EmptyState } from '@/components/ui/EmptyState';

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
  const [excelBusy, setExcelBusy] = useState(false);

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

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => items.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'customers'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Customers</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Customers</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handleExport} disabled={excelBusy} aria-label="Export to Excel">
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
          </div>
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={handlePrint} aria-label="Print">
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
          </div>
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
          emptyMessage={<EmptyState title="No customers yet" hint="Add your first customer to start invoicing." actionLabel="New customer" actionTo="/customers/new" />}
        />
      </CardContent></Card>
    </div>
  );
}
