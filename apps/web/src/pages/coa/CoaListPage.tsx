import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';

type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

function statusBadge(active: boolean) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  return active
    ? <span className={`${base} bg-emerald-100 text-emerald-800`}>Active</span>
    : <span className={`${base} bg-muted text-muted-foreground`}>Inactive</span>;
}

export default function CoaListPage() {
  const [bizId] = useActiveBusinessId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', account_type: 'asset' });
  const [err, setErr] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [search, setSearch] = useState('');

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/coa?include_inactive=true`);
    setAccounts(r.data.accounts);
  }
  useEffect(() => { reload(); }, [bizId]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/coa`, { ...form, parent_id: null });
      setForm({ code: '', name: '', account_type: 'asset' }); setShowCreate(false);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter(a => {
      if (typeFilter && a.account_type !== typeFilter) return false;
      if (statusFilter === 'active' && !a.is_active) return false;
      if (statusFilter === 'inactive' && a.is_active) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [accounts, typeFilter, statusFilter, search]);

  const columns: Column<Account>[] = [
    { key: 'code', header: 'No.', sortable: true, sortValue: r => r.code, render: r => <span className="font-mono text-muted-foreground">{r.code}</span> },
    { key: 'name', header: 'Name', sortable: true, sortValue: r => r.name, render: r => <span className="font-medium">{r.name}</span> },
    { key: 'account_type', header: 'Type', sortable: true, sortValue: r => r.account_type, render: r => <span className="capitalize">{r.account_type}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.is_active ? 'active' : 'inactive', render: r => statusBadge(r.is_active) },
    { key: 'system', header: 'Source', sortable: true, sortValue: r => r.is_system ? 'system' : 'user', render: r => <span className="text-muted-foreground">{r.is_system ? 'System' : 'User'}</span> },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Chart of Accounts</h1>
        <Button onClick={() => setShowCreate(s => !s)}>{showCreate ? 'Cancel' : 'New account'}</Button>
      </div>

      {showCreate && (
        <Card><CardHeader><CardTitle>New account</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={create}>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>No.</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
                <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div>
                  <Label>Type</Label>
                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.account_type} onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))}>
                    {ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button type="submit">Create</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Account type</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {ACCOUNT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
          </select>
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Status</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="min-w-[14rem] flex-1">
          <div className="mb-1 text-xs text-muted-foreground">Search</div>
          <Input className="h-9" placeholder="Search by name or number" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <Card><CardContent className="p-0">
        <DataTable
          rows={filtered}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="code"
          defaultSortDir="asc"
          downloadable={{ filename: 'chart-of-accounts', title: 'Chart of Accounts' }}
          emptyMessage={<EmptyState title="No accounts found" hint="Adjust the filters above, or add a new account to your chart." />}
        />
      </CardContent></Card>
    </div>
  );
}
