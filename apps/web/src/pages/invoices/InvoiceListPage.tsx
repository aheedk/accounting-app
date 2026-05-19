import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowDown, ArrowUpDown, Settings, AlertCircle, ChevronDown } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type InvoiceStatus = 'draft' | 'posted' | 'paid' | 'voided';
type InvoiceSummary = { id: string; customer_id: string; invoice_number: string; issue_date: string; due_date: string; status: InvoiceStatus; total: string };
type Customer = { id: string; name: string };
type SortKey = 'issue_date' | 'invoice_number' | 'customer' | 'total' | 'status';
type SortDir = 'asc' | 'desc';

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
  const [sortKey, setSortKey] = useState<SortKey>('issue_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/invoices`, { params: statusFilter ? { status: statusFilter } : {} }).then(r => setItems(r.data.invoices));
  }, [bizId, statusFilter]);
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
  }, [bizId]);

  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c.name])), [customers]);
  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo(() => {
    const enriched = items.map(i => ({
      ...i,
      customer_name: customerMap.get(i.customer_id) ?? '',
      amount_num: Number(i.total),
      overdue_days: i.status === 'posted' && i.due_date < today ? daysBetween(i.due_date, today) : 0,
    }));
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...enriched].sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sortKey) {
        case 'issue_date': av = a.issue_date; bv = b.issue_date; break;
        case 'invoice_number': av = a.invoice_number; bv = b.invoice_number; break;
        case 'customer': av = a.customer_name.toLowerCase(); bv = b.customer_name.toLowerCase(); break;
        case 'total': av = a.amount_num; bv = b.amount_num; break;
        case 'status': av = a.status; bv = b.status; break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [items, customerMap, sortKey, sortDir, today]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  }
  function toggleRow(id: string) {
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  function toggleAll() { setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id))); }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <div className="flex items-center gap-3">
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>{['draft', 'posted', 'paid', 'voided'].map(s => <option key={s}>{s}</option>)}
          </select>
          <Button asChild><Link to="/invoices/new">New invoice</Link></Button>
        </div>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="p-3 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>
              <SortHeader label="Date" k="issue_date" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="No." k="invoice_number" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Customer" k="customer" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Amount" k="total" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <th className="p-3 text-right">
                <span className="inline-flex items-center gap-1.5">Action <Settings className="h-3.5 w-3.5" /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const canReceivePayment = r.status === 'posted';
              return (
                <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="p-3"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} aria-label={`Select invoice ${r.invoice_number}`} /></td>
                  <td className="p-3 whitespace-nowrap">{fmtShortDate(r.issue_date)}</td>
                  <td className="p-3 font-mono">{r.invoice_number}</td>
                  <td className="p-3">{r.customer_name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3 text-right font-mono">{fmtMoney(r.total)}</td>
                  <td className="p-3">
                    {r.overdue_days > 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-destructive">
                        <AlertCircle className="h-4 w-4" /> Overdue {r.overdue_days} day{r.overdue_days === 1 ? '' : 's'}
                      </span>
                    ) : (
                      <span className="capitalize">{r.status}</span>
                    )}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <Link className="text-primary hover:underline" to={`/invoices/${r.id}`}>View/Edit</Link>
                      {canReceivePayment && (
                        <>
                          <span className="text-muted-foreground/50">|</span>
                          <Link className="text-primary hover:underline" to={`/payments/new?customer_id=${r.customer_id}&invoice_id=${r.id}`}>Receive payment</Link>
                        </>
                      )}
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No invoices.</td></tr>
            )}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}

function SortHeader({ label, k, sortKey, sortDir, onClick, align = 'left' }: { label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir; onClick: (k: SortKey) => void; align?: 'left' | 'right' }) {
  const active = sortKey === k;
  return (
    <th className={`p-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 ${active ? 'text-foreground' : ''} hover:text-foreground`}
      >
        {label}
        {active ? (sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />) : <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />}
      </button>
    </th>
  );
}
