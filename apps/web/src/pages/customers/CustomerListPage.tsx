import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronDown } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type Customer = {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  default_terms_days: number;
  open_balance: string | null;
};

type SortKey = 'name' | 'company_name' | 'open_balance';
type SortDir = 'asc' | 'desc';

export default function CustomerListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<Customer[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setItems(r.data.customers));
  }, [bizId]);

  const rows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      switch (sortKey) {
        case 'name':
          av = a.name.toLowerCase();
          bv = b.name.toLowerCase();
          break;
        case 'company_name':
          av = (a.company_name ?? '').toLowerCase();
          bv = (b.company_name ?? '').toLowerCase();
          break;
        case 'open_balance':
          av = Number(a.open_balance ?? 0);
          bv = Number(b.open_balance ?? 0);
          break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [items, sortKey, sortDir]);

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
        <h1 className="text-2xl font-semibold">Customers</h1>
        <Button asChild><Link to="/customers/new">New customer</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="p-3 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>
              <SortHeader label="Name" k="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Company name" k="company_name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <th className="p-3 text-left">Phone</th>
              <SortHeader label="Open balance" k="open_balance" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => {
              const openNum = Number(c.open_balance ?? 0);
              const hasBalance = openNum > 0;
              return (
                <tr key={c.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="p-3"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleRow(c.id)} aria-label={`Select ${c.name}`} /></td>
                  <td className="p-3 font-medium">
                    <Link className="hover:underline" to={`/customers/${c.id}`}>{c.name}</Link>
                  </td>
                  <td className="p-3">{c.company_name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3 whitespace-nowrap">{c.phone || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3 text-right font-mono">{fmtMoney((c.open_balance ?? '0').toString())}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      {hasBalance ? (
                        <Link className="text-primary hover:underline" to={`/payments/new?customer_id=${c.id}`}>Receive payment</Link>
                      ) : (
                        <Link className="text-primary hover:underline" to={`/invoices/new?customer_id=${c.id}`}>Create invoice</Link>
                      )}
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No customers.</td></tr>
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
