import { useEffect, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';

function statusBadge(active: boolean) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  return active
    ? <span className={`${base} bg-emerald-100 text-emerald-800`}>Active</span>
    : <span className={`${base} bg-muted text-muted-foreground`}>Inactive</span>;
}

type Account = {
  id: string;
  name: string;
  institution: string | null;
  account_last_four: string | null;
  cash_account_id: string;
  is_active: boolean;
  cash_account_code: string;
  cash_account_name: string;
};

type CashAccountRow = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_system: boolean;
  is_active: boolean;
};

export default function BankAccountListPage() {
  const [bizId] = useActiveBusinessId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [excelBusy, setExcelBusy] = useState(false);
  const [cashAccounts, setCashAccounts] = useState<CashAccountRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', institution: '', account_last_four: '', cash_account_id: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/bank-accounts`);
    setAccounts(r.data.bank_accounts);
  }

  useEffect(() => {
    if (!bizId) return;
    reload();
    api.get(`/businesses/${bizId}/coa`).then(r => {
      const rows = r.data.accounts as CashAccountRow[];
      setCashAccounts(rows.filter(a => a.account_type === 'asset' && a.is_active && a.code.startsWith('10')));
    });
  }, [bizId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post(`/businesses/${bizId}/bank-accounts`, {
        name: form.name,
        institution: form.institution || null,
        account_last_four: form.account_last_four || null,
        cash_account_id: form.cash_account_id,
      });
      setForm({ name: '', institution: '', account_last_four: '', cash_account_id: '' });
      setShowCreate(false);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const filtered = statusFilter
    ? accounts.filter(a => (statusFilter === 'active' ? a.is_active : !a.is_active))
    : accounts;

  const columns: Column<Account>[] = [
    { key: 'name', header: 'Name', sortable: true, sortValue: r => r.name, render: r => r.name },
    { key: 'institution', header: 'Institution', sortable: true, sortValue: r => r.institution ?? '', render: r => r.institution || <span className="text-muted-foreground">—</span> },
    { key: 'account_last_four', header: 'Last 4', sortable: true, sortValue: r => r.account_last_four ?? '', render: r => <span className="font-mono">{r.account_last_four || <span className="text-muted-foreground">—</span>}</span> },
    { key: 'cash_account', header: 'Linked CoA', sortable: true, sortValue: r => `${r.cash_account_code} ${r.cash_account_name}`, render: r => <span className="font-mono">{r.cash_account_code} — {r.cash_account_name}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.is_active ? 'active' : 'inactive', render: r => statusBadge(r.is_active) },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => accounts.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'bank-accounts'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Bank Accounts</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Bank Accounts</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bank Accounts</h1>
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
          <Button onClick={() => setShowCreate(s => !s)}>{showCreate ? 'Cancel' : 'Add bank account'}</Button>
        </div>
      </div>

      {showCreate && (
        <Card>
          <CardHeader><CardTitle>New bank account</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={create}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Name</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
                </div>
                <div>
                  <Label>Institution</Label>
                  <Input value={form.institution} onChange={e => setForm(f => ({ ...f, institution: e.target.value }))} />
                </div>
                <div>
                  <Label>Last 4</Label>
                  <Input value={form.account_last_four} onChange={e => setForm(f => ({ ...f, account_last_four: e.target.value }))} maxLength={4} placeholder="1234" />
                </div>
                <div>
                  <Label>Cash account</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.cash_account_id}
                    onChange={e => setForm(f => ({ ...f, cash_account_id: e.target.value }))}
                    required
                  >
                    <option value="">Select…</option>
                    {cashAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
              </div>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create'}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Status</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable
            rows={filtered}
            getRowId={r => r.id}
            columns={columns}
            defaultSortKey="name"
            defaultSortDir="asc"
            downloadable={{ filename: 'bank-accounts', title: 'Bank Accounts' }}
            emptyMessage={<EmptyState title="No bank accounts yet" hint="Add a bank account and link it to a cash account in your chart of accounts." />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
