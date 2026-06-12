import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ChevronDown, Settings, X } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { EmptyState } from '@/components/ui/EmptyState';

type BillSummary = { id: string; bill_number: string; vendor_id: string; bill_date: string; due_date: string; status: string; total: string };
type Vendor = { id: string; name: string };

// QBO bills page tabs: For review (draft) / Unpaid (posted) / Paid / All.
const TABS = [
  { value: 'draft', label: 'For review' },
  { value: 'posted', label: 'Unpaid' },
  { value: 'paid', label: 'Paid' },
  { value: '', label: 'All' },
] as const;

const DATE_RANGES = [
  { value: 'year', label: 'This year' },
  { value: '3m', label: 'Last 3 months' },
  { value: '12m', label: 'Last 12 months' },
  { value: 'all', label: 'All dates' },
] as const;

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}
function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
function daysBetween(fromIso: string, toIso: string) {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86_400_000);
}

function dateRangeBounds(value: string): { from: string; to: string } | null {
  const today = todayLocal();
  if (value === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  if (value === '3m') return { from: isoDaysAgo(92), to: today };
  if (value === '12m') return { from: isoDaysAgo(365), to: today };
  return null;
}

export default function BillListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<BillSummary[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [tab, setTab] = useState<string>('posted');
  const [vendorFilter, setVendorFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<string>('year');

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/bills`, { params: { limit: 1000, ...(tab ? { status: tab } : {}) } }).then(r => setItems(r.data.bills));
  }, [bizId, tab]);
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/vendors`).then(r => setVendors(r.data.vendors));
  }, [bizId]);

  const vendorMap = useMemo(() => new Map(vendors.map(v => [v.id, v.name])), [vendors]);
  const today = todayLocal();

  type Row = BillSummary & { vendor_name: string; overdue_days: number };
  const rows: Row[] = useMemo(() => {
    const bounds = dateRangeBounds(dateFilter);
    return items
      .filter(b => (!vendorFilter || b.vendor_id === vendorFilter) && (!bounds || (b.bill_date >= bounds.from && b.bill_date <= bounds.to)))
      .map(b => ({
        ...b,
        vendor_name: vendorMap.get(b.vendor_id) ?? '',
        overdue_days: b.status === 'posted' && b.due_date < today ? daysBetween(b.due_date, today) : 0,
      }));
  }, [items, vendorMap, vendorFilter, dateFilter, today]);

  const columns: Column<Row>[] = [
    { key: 'vendor', header: 'Vendor', sortable: true, sortValue: r => r.vendor_name, render: r => r.vendor_name || <span className="text-muted-foreground">—</span> },
    { key: 'bill_number', header: 'No.', sortable: true, sortValue: r => r.bill_number, render: r => <span className="font-mono">{r.bill_number}</span> },
    { key: 'bill_date', header: 'Bill date', sortable: true, sortValue: r => r.bill_date, render: r => <span className="whitespace-nowrap">{fmtShortDate(r.bill_date)}</span> },
    { key: 'due_date', header: 'Due date', sortable: true, sortValue: r => r.due_date, render: r => <span className="whitespace-nowrap">{fmtShortDate(r.due_date)}</span> },
    { key: 'total', header: 'Bill amount', sortable: true, align: 'right', sortValue: r => Number(r.total), render: r => <span className="font-mono">{fmtMoney(r.total)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => r.overdue_days > 0
      ? <span className="inline-flex items-center gap-1.5 text-destructive"><AlertCircle className="h-4 w-4" /> Overdue {r.overdue_days} day{r.overdue_days === 1 ? '' : 's'}</span>
      : <span className="capitalize">{r.status === 'posted' ? 'Open' : r.status}</span> },
  ];

  const bounds = dateRangeBounds(dateFilter);

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bills</h1>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline"><Link to="/ap/bill-payments/new">Pay bills</Link></Button>
          <Button asChild><Link to="/ap/bills/new">Add bill</Link></Button>
        </div>
      </div>

      <div className="inline-flex rounded-md border bg-background p-0.5">
        {TABS.map(t => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`rounded px-4 py-1.5 text-sm font-medium ${tab === t.value ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Vendor</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
            <option value="">All</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Bill date</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
            {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        {bounds && (
          <span className="inline-flex h-9 items-center gap-2 rounded-full border bg-muted/40 px-3 text-sm">
            Bill date: {fmtShortDate(bounds.from)}–{fmtShortDate(bounds.to)}
            <button type="button" aria-label="Clear date filter" onClick={() => setDateFilter('all')}>
              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          </span>
        )}
      </div>

      <Card><CardContent className="p-0">
        <DataTable
          rows={rows}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="due_date"
          defaultSortDir="asc"
          downloadable={{ filename: 'bills', title: 'Bills' }}
          actionsHeader={<span className="inline-flex items-center gap-1.5">Action <Settings className="h-3.5 w-3.5" /></span>}
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/ap/bills/${r.id}`}>View/Edit</Link>
              {r.status === 'posted' && (
                <>
                  <span className="text-muted-foreground/50">|</span>
                  <Link className="text-primary hover:underline" to={`/ap/bill-payments/new?vendor_id=${r.vendor_id}&bill_id=${r.id}`}>Pay bill</Link>
                </>
              )}
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage={<EmptyState title="No bills found" hint="Adjust the filters above, or enter a bill to schedule a payment." actionLabel="Add bill" actionTo="/ap/bills/new" />}
        />
      </CardContent></Card>
    </div>
  );
}
