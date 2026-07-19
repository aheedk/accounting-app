import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, FileDown, Printer, Settings } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MoneyBar } from '@/components/ui/MoneyBar';
import { fmtMoney } from '@/lib/money';
import { EmptyState } from '@/components/ui/EmptyState';
import { currentYearLocal, daysAgoLocal } from '@/lib/dates';

type CreditMemoSummary = {
  id: string;
  customer_id: string;
  memo_date: string;
  status: string;
  amount: string;
  remaining_amount: string;
  memo: string | null;
};
type Customer = { id: string; name: string };

const STATUSES = ['draft', 'posted', 'applied', 'voided'];
const DATE_RANGES = [
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '3m', label: 'Last 3 months', days: 92 },
  { value: '12m', label: 'Last 12 months', days: 365 },
  { value: 'all', label: 'All dates', days: 0 },
] as const;

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}
export default function CreditMemoListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<CreditMemoSummary[]>([]);
  const [excelBusy, setExcelBusy] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<string>('3m');
  const [customerQuery, setCustomerQuery] = useState('');

  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/credit-memos`).then(r => setItems(r.data.credit_memos)); }, [bizId]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers)); }, [bizId]);

  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c.name])), [customers]);

  type Row = CreditMemoSummary & { customer_name: string };
  const allRows: Row[] = useMemo(
    () => items.map(c => ({ ...c, customer_name: customerMap.get(c.customer_id) ?? '' })),
    [items, customerMap],
  );

  const rows = useMemo(() => {
    const range = DATE_RANGES.find(r => r.value === dateFilter);
    const cutoff = range && range.days > 0 ? daysAgoLocal(range.days) : '';
    const q = customerQuery.trim().toLowerCase();
    return allRows.filter(r =>
      (!statusFilter || r.status === statusFilter) &&
      (!cutoff || r.memo_date >= cutoff) &&
      (!q || r.customer_name.toLowerCase().includes(q)),
    );
  }, [allRows, statusFilter, dateFilter, customerQuery]);

  // Money bar totals are computed across all credit memos, unfiltered (QBO behavior).
  const stats = useMemo(() => {
    const yearStart = `${currentYearLocal()}-01-01`;
    const recentCutoff = daysAgoLocal(30);
    let issued = 0, remaining = 0, drafts = 0, draftCount = 0, recent = 0, recentCount = 0;
    for (const c of items) {
      const amt = Number(c.amount);
      if (c.status === 'draft') { drafts += amt; draftCount += 1; }
      if (c.status === 'posted' || c.status === 'applied') {
        remaining += Number(c.remaining_amount);
        if (c.memo_date >= yearStart) issued += amt;
        if (c.memo_date >= recentCutoff) { recent += amt; recentCount += 1; }
      }
    }
    return { issued, remaining, drafts, draftCount, recent, recentCount };
  }, [items]);

  const columns: Column<Row>[] = [
    { key: 'memo_date', header: 'Date', sortable: true, sortValue: r => r.memo_date, render: r => <span className="whitespace-nowrap">{fmtShortDate(r.memo_date)}</span> },
    { key: 'customer', header: 'Customer', sortable: true, sortValue: r => r.customer_name, render: r => r.customer_name || <span className="text-muted-foreground">—</span> },
    { key: 'memo', header: 'Memo', sortable: false, render: r => r.memo ? <span className="block max-w-[16rem] truncate">{r.memo}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'amount', header: 'Amount', sortable: true, align: 'right', sortValue: r => Number(r.amount), render: r => <span className="font-mono">{fmtMoney(r.amount)}</span> },
    { key: 'remaining_amount', header: 'Remaining', sortable: true, align: 'right', sortValue: r => Number(r.remaining_amount), render: r => <span className="font-mono">{fmtMoney(r.remaining_amount)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => <span className="capitalize">{r.status}</span> },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => allRows.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'credit-memos'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Credit Memos</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Credit Memos</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Credit Memos</h1>
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
      </div>

      <MoneyBar segments={[
        { amount: stats.issued, caption: 'Issued this year', colorClass: 'bg-blue-400' },
        { amount: stats.remaining, caption: 'Remaining credit', colorClass: 'bg-orange-400' },
        { amount: stats.drafts, caption: `${stats.draftCount} draft credit memo${stats.draftCount === 1 ? '' : 's'}`, colorClass: 'bg-gray-300' },
        { amount: stats.recent, caption: `${stats.recentCount} recently issued`, colorClass: 'bg-green-600' },
      ]} />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Date</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
            {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Customer</div>
          <input
            className="h-9 w-48 rounded-md border bg-background px-3 text-sm"
            placeholder="Search"
            value={customerQuery}
            onChange={e => setCustomerQuery(e.target.value)}
          />
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Status</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="ml-auto">
          <Button asChild><Link to="/credit-memos/new">New credit memo</Link></Button>
        </div>
      </div>

      <Card><CardContent className="p-0">
        <DataTable
          rows={rows}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="memo_date"
          defaultSortDir="desc"
          actionsHeader={<span className="inline-flex items-center gap-1.5">Action <Settings className="h-3.5 w-3.5" /></span>}
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/credit-memos/${r.id}`}>View/Edit</Link>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage={<EmptyState title="No matching credit memos" hint="Adjust the filters above, or issue a credit to a customer." actionLabel="New credit memo" actionTo="/credit-memos/new" />}
        />
      </CardContent></Card>
    </div>
  );
}
