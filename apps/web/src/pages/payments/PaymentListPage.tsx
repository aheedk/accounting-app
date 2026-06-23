import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Settings } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MoneyBar } from '@/components/ui/MoneyBar';
import { fmtMoney } from '@/lib/money';
import { EmptyState } from '@/components/ui/EmptyState';
import { currentYearLocal, daysAgoLocal } from '@/lib/dates';

type PaymentSummary = {
  id: string;
  customer_id: string;
  payment_date: string;
  payment_method: string;
  reference: string | null;
  memo: string | null;
  status: string;
  amount: string;
  unapplied_amount: string;
};
type Customer = { id: string; name: string };

const METHODS = ['cash', 'check', 'ach', 'wire', 'card', 'other'];
const STATUSES = ['draft', 'posted', 'voided'];
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
export default function PaymentListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<PaymentSummary[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [methodFilter, setMethodFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<string>('3m');
  const [customerQuery, setCustomerQuery] = useState('');

  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/payments`).then(r => setItems(r.data.payments)); }, [bizId]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers)); }, [bizId]);

  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c.name])), [customers]);

  type Row = PaymentSummary & { customer_name: string };
  const allRows: Row[] = useMemo(
    () => items.map(p => ({ ...p, customer_name: customerMap.get(p.customer_id) ?? '' })),
    [items, customerMap],
  );

  const rows = useMemo(() => {
    const range = DATE_RANGES.find(r => r.value === dateFilter);
    const cutoff = range && range.days > 0 ? daysAgoLocal(range.days) : '';
    const q = customerQuery.trim().toLowerCase();
    return allRows.filter(r =>
      (!methodFilter || r.payment_method === methodFilter) &&
      (!statusFilter || r.status === statusFilter) &&
      (!cutoff || r.payment_date >= cutoff) &&
      (!q || r.customer_name.toLowerCase().includes(q)),
    );
  }, [allRows, methodFilter, statusFilter, dateFilter, customerQuery]);

  // Money bar totals are computed across all payments, unfiltered (QBO behavior).
  const stats = useMemo(() => {
    const yearStart = `${currentYearLocal()}-01-01`;
    const recentCutoff = daysAgoLocal(30);
    let received = 0, unapplied = 0, drafts = 0, draftCount = 0, recent = 0, recentCount = 0;
    for (const p of items) {
      const amt = Number(p.amount);
      if (p.status === 'draft') { drafts += amt; draftCount += 1; }
      if (p.status === 'posted') {
        unapplied += Number(p.unapplied_amount);
        if (p.payment_date >= yearStart) received += amt;
        if (p.payment_date >= recentCutoff) { recent += amt; recentCount += 1; }
      }
    }
    return { received, unapplied, drafts, draftCount, recent, recentCount };
  }, [items]);

  const columns: Column<Row>[] = [
    { key: 'payment_date', header: 'Date', sortable: true, sortValue: r => r.payment_date, render: r => <span className="whitespace-nowrap">{fmtShortDate(r.payment_date)}</span> },
    { key: 'payment_method', header: 'Method', sortable: true, sortValue: r => r.payment_method, render: r => <span className="capitalize">{r.payment_method}</span> },
    { key: 'reference', header: 'No.', sortable: true, sortValue: r => r.reference ?? '', render: r => r.reference ? <span className="font-mono">{r.reference}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'customer', header: 'Customer', sortable: true, sortValue: r => r.customer_name, render: r => r.customer_name || <span className="text-muted-foreground">—</span> },
    { key: 'memo', header: 'Memo', sortable: false, render: r => r.memo ? <span className="block max-w-[16rem] truncate">{r.memo}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'amount', header: 'Amount', sortable: true, align: 'right', sortValue: r => Number(r.amount), render: r => <span className="font-mono">{fmtMoney(r.amount)}</span> },
    { key: 'unapplied_amount', header: 'Unapplied', sortable: true, align: 'right', sortValue: r => Number(r.unapplied_amount), render: r => <span className="font-mono">{fmtMoney(r.unapplied_amount)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => <span className="capitalize">{r.status}</span> },
  ];

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Payments</h1>

      <MoneyBar segments={[
        { amount: stats.received, caption: 'Received this year', colorClass: 'bg-blue-400' },
        { amount: stats.unapplied, caption: 'Unapplied to invoices', colorClass: 'bg-orange-400' },
        { amount: stats.drafts, caption: `${stats.draftCount} draft payment${stats.draftCount === 1 ? '' : 's'}`, colorClass: 'bg-gray-300' },
        { amount: stats.recent, caption: `${stats.recentCount} recently received`, colorClass: 'bg-green-600' },
      ]} />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Method</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={methodFilter} onChange={e => setMethodFilter(e.target.value)}>
            <option value="">All methods</option>{METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
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
          <Button asChild><Link to="/payments/new">Record payment</Link></Button>
        </div>
      </div>

      <Card><CardContent className="p-0">
        <DataTable
          rows={rows}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="payment_date"
          defaultSortDir="desc"
          downloadable={{ filename: 'payments', title: 'Payments' }}
          actionsHeader={<span className="inline-flex items-center gap-1.5">Action <Settings className="h-3.5 w-3.5" /></span>}
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/payments/${r.id}`}>View/Edit</Link>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage={<EmptyState title="No matching payments" hint="Adjust the filters above, or record a customer payment." actionLabel="Record payment" actionTo="/payments/new" />}
        />
      </CardContent></Card>
    </div>
  );
}
