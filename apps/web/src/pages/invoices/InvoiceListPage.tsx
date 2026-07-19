import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ChevronDown, FileDown, Printer, Settings } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { EmptyState } from '@/components/ui/EmptyState';

type InvoiceStatus = 'draft' | 'posted' | 'paid' | 'voided';
type InvoiceSummary = { id: string; customer_id: string; invoice_number: string; issue_date: string; due_date: string; status: InvoiceStatus; total: string };
type Customer = { id: string; name: string };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}
function daysBetween(fromIso: string, toIso: string) {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86_400_000);
}

export default function InvoiceListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<InvoiceSummary[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [excelBusy, setExcelBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/invoices`, { params: statusFilter ? { status: statusFilter } : {} }).then(r => setItems(r.data.invoices));
  }, [bizId, statusFilter]);
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
  }, [bizId]);

  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c.name])), [customers]);
  const today = todayLocal();

  type Row = InvoiceSummary & { customer_name: string; overdue_days: number };
  const rows: Row[] = useMemo(
    () => items.map(i => ({
      ...i,
      customer_name: customerMap.get(i.customer_id) ?? '',
      overdue_days: i.status === 'posted' && i.due_date < today ? daysBetween(i.due_date, today) : 0,
    })),
    [items, customerMap, today],
  );

  const columns: Column<Row>[] = [
    { key: 'issue_date', header: 'Date', sortable: true, sortValue: r => r.issue_date, render: r => <span className="whitespace-nowrap">{fmtShortDate(r.issue_date)}</span> },
    { key: 'invoice_number', header: 'No.', sortable: true, sortValue: r => r.invoice_number, render: r => <span className="font-mono">{r.invoice_number}</span> },
    { key: 'customer', header: 'Customer', sortable: true, sortValue: r => r.customer_name, render: r => r.customer_name || <span className="text-muted-foreground">—</span> },
    { key: 'total', header: 'Amount', sortable: true, align: 'right', sortValue: r => Number(r.total), render: r => <span className="font-mono">{fmtMoney(r.total)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => r.overdue_days > 0
      ? <span className="inline-flex items-center gap-1.5 text-destructive"><AlertCircle className="h-4 w-4" /> Overdue {r.overdue_days} day{r.overdue_days === 1 ? '' : 's'}</span>
      : <span className="capitalize">{r.status}</span> },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => rows.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'invoices'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Invoices</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Invoices</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <div className="flex items-center gap-3">
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>{['draft', 'posted', 'paid', 'voided'].map(s => <option key={s}>{s}</option>)}
          </select>
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
          </div>
          <Button asChild><Link to="/invoices/new">New invoice</Link></Button>
        </div>
      </div>
      <Card><CardContent className="p-0">
        <DataTable
          rows={rows}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="issue_date"
          defaultSortDir="desc"
          actionsHeader={<span className="inline-flex items-center gap-1.5">Action <Settings className="h-3.5 w-3.5" /></span>}
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/invoices/${r.id}`}>View/Edit</Link>
              {r.status === 'posted' && (
                <>
                  <span className="text-muted-foreground/50">|</span>
                  <Link className="text-primary hover:underline" to={`/payments/new?customer_id=${r.customer_id}&invoice_id=${r.id}`}>Receive payment</Link>
                </>
              )}
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage={<EmptyState title="No invoices found" hint="Bill a customer for goods or services." actionLabel="New invoice" actionTo="/invoices/new" />}
        />
      </CardContent></Card>
    </div>
  );
}
