import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';

type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };

export default function CoaListPage() {
  const [bizId] = useActiveBusinessId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', account_type: 'asset' });
  const [err, setErr] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');

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

  const filtered = typeFilter ? accounts.filter(a => a.account_type === typeFilter) : accounts;

  const columns: Column<Account>[] = [
    { key: 'code', header: 'Code', sortable: true, sortValue: r => r.code, render: r => <span className="font-mono">{r.code}</span> },
    { key: 'name', header: 'Name', sortable: true, sortValue: r => r.name, render: r => r.name },
    { key: 'account_type', header: 'Type', sortable: true, sortValue: r => r.account_type, render: r => <span className="capitalize">{r.account_type}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.is_active ? 'active' : 'inactive', render: r => <span className="capitalize">{r.is_active ? 'active' : 'inactive'}</span> },
    { key: 'system', header: 'System', sortable: true, sortValue: r => r.is_system ? 'yes' : 'no', render: r => r.is_system ? 'yes' : 'no' },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Chart of Accounts</h1>
        <div className="flex items-center gap-3">
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {['asset','liability','equity','revenue','expense'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <Button onClick={() => setShowCreate(s => !s)}>{showCreate ? 'Cancel' : 'Add account'}</Button>
        </div>
      </div>

      {showCreate && (
        <Card><CardHeader><CardTitle>New account</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={create}>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Code</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
                <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div>
                  <Label>Type</Label>
                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.account_type} onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))}>
                    {['asset','liability','equity','revenue','expense'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button type="submit">Create</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card><CardContent className="p-0">
        <DataTable
          rows={filtered}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="code"
          defaultSortDir="asc"
          downloadable={{ filename: 'chart-of-accounts', title: 'Chart of Accounts' }}
          emptyMessage="No accounts."
        />
      </CardContent></Card>
    </div>
  );
}
