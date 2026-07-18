import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, FileDown, Printer, Settings, X } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import type { Role } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { fmtMoney } from '@/lib/money';
import { EmptyState } from '@/components/ui/EmptyState';
import { daysAgoLocal } from '@/lib/dates';

type ExpenseStatus = 'draft' | 'posted' | 'void';
type StatusFilter = ExpenseStatus | 'all';

type ExpenseTransaction = {
  id: string;
  business_id: string;
  transaction_date: string;
  payee_text: string | null;
  vendor_id: string | null;
  expense_account_id: string;
  payment_account_id: string;
  amount: string;
  memo: string | null;
  status: ExpenseStatus;
  journal_entry_id: string | null;
};

type ListResponse = { expense_transactions: ExpenseTransaction[] };
type Vendor = { id: string; name: string };
type Account = { id: string; name: string };

const ROLE_RANK: Record<Role, number> = {
  client: 0,
  staff: 1,
  accountant: 2,
  firm_admin: 3,
};

function roleAtLeast(role: Role | undefined, floor: Role): boolean {
  if (!role) return false;
  const r = ROLE_RANK[role] ?? -1;
  const f = ROLE_RANK[floor] ?? Number.POSITIVE_INFINITY;
  return r >= f;
}

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All transactions' },
  { value: 'draft', label: 'Draft' },
  { value: 'posted', label: 'Posted' },
  { value: 'void', label: 'Void' },
];

const DATE_RANGES = [
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '3m', label: 'Last 3 months', days: 92 },
  { value: '12m', label: 'Last 12 months', days: 365 },
  { value: 'all', label: 'All dates', days: 0 },
] as const;

function statusBadge(status: ExpenseStatus) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  switch (status) {
    case 'draft':
      return <span className={`${base} bg-amber-100 text-amber-800`}>draft</span>;
    case 'posted':
      return <span className={`${base} bg-emerald-100 text-emerald-800`}>posted</span>;
    case 'void':
      return <span className={`${base} bg-muted text-muted-foreground`}>void</span>;
    default:
      return <span className={base}>{status}</span>;
  }
}

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}
export default function ExpenseTransactionListPage() {
  const [bizId] = useActiveBusinessId();
  const { user } = useAuth();
  const canMutate = roleAtLeast(user?.role, 'accountant');

  const [excelBusy, setExcelBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<string>('12m');
  const [items, setItems] = useState<ExpenseTransaction[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!bizId) { setItems([]); return; }
    setErr(null);
    try {
      const params: { status?: ExpenseStatus } = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      const r = await api.get<ListResponse>(`/businesses/${bizId}/expense-transactions`, { params });
      setItems(r.data.expense_transactions);
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }, [bizId, statusFilter]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/vendors`).then(r => setVendors(r.data.vendors));
    api.get(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts));
  }, [bizId]);

  const vendorMap = useMemo(() => new Map(vendors.map(v => [v.id, v.name])), [vendors]);
  const accountMap = useMemo(() => new Map(accounts.map(a => [a.id, a.name])), [accounts]);

  async function postExpense(t: ExpenseTransaction) {
    if (!bizId) return;
    if (!window.confirm(`Post expense ${t.id.slice(0, 8)} to the ledger?`)) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/expense-transactions/${t.id}/post`);
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function voidExpense(t: ExpenseTransaction) {
    if (!bizId) return;
    if (!window.confirm(`Void expense ${t.id.slice(0, 8)}? This cannot be undone.`)) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/expense-transactions/${t.id}/void`);
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  type Row = ExpenseTransaction & { payee_name: string; category_name: string };
  const rows: Row[] = useMemo(() => {
    const range = DATE_RANGES.find(r => r.value === dateFilter);
    const cutoff = range && range.days > 0 ? daysAgoLocal(range.days) : '';
    return items
      .filter(t => !cutoff || t.transaction_date >= cutoff)
      .map(t => ({
        ...t,
        payee_name: t.payee_text ?? (t.vendor_id ? vendorMap.get(t.vendor_id) ?? '' : ''),
        category_name: accountMap.get(t.expense_account_id) ?? '',
      }));
  }, [items, dateFilter, vendorMap, accountMap]);

  const columns: Column<Row>[] = [
    { key: 'transaction_date', header: 'Date', sortable: true, sortValue: r => r.transaction_date, render: r => <span className="whitespace-nowrap">{fmtShortDate(r.transaction_date)}</span> },
    { key: 'type', header: 'Type', sortable: false, render: () => 'Expense' },
    { key: 'payee', header: 'Payee', sortable: true, sortValue: r => r.payee_name, render: r => r.payee_name || <span className="text-muted-foreground">—</span> },
    { key: 'category', header: 'Category', sortable: true, sortValue: r => r.category_name, render: r => r.category_name || <span className="text-muted-foreground">—</span> },
    { key: 'amount', header: 'Total', align: 'right', sortable: true, sortValue: r => Number(r.amount), render: r => <span className="font-mono">{fmtMoney(r.amount)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => statusBadge(r.status) },
  ];

  const range = DATE_RANGES.find(r => r.value === dateFilter);

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => rows.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'expense-transactions'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Expenses</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Expenses</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Expenses</h1>
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
          <Button asChild><Link to="/ap/expenses/new">New transaction</Link></Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={dateFilter}
          onChange={e => setDateFilter(e.target.value)}
        >
          {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {range && range.days > 0 && (
          <span className="inline-flex h-9 items-center gap-2 rounded-full border bg-muted/40 px-3 text-sm">
            Dates: <span className="font-medium">{range.label}</span>
            <button type="button" aria-label="Clear date filter" onClick={() => setDateFilter('all')}>
              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          </span>
        )}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card><CardContent className="p-0">
        <DataTable
          rows={rows}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="transaction_date"
          defaultSortDir="desc"
          actionsHeader={<span className="inline-flex items-center gap-1.5">Action <Settings className="h-3.5 w-3.5" /></span>}
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/ap/expenses/${r.id}`}>View/Edit</Link>
              {canMutate && r.status === 'draft' && (
                <>
                  <span className="text-muted-foreground/50">|</span>
                  <button type="button" className="text-primary hover:underline" onClick={() => postExpense(r)} disabled={busy}>Post</button>
                </>
              )}
              {canMutate && (r.status === 'draft' || r.status === 'posted') && (
                <>
                  <span className="text-muted-foreground/50">|</span>
                  <button type="button" className="text-primary hover:underline" onClick={() => voidExpense(r)} disabled={busy}>Void</button>
                </>
              )}
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage={<EmptyState title="No expenses found" hint="Adjust the filters above, or record money you spent." actionLabel="New transaction" actionTo="/ap/expenses/new" />}
        />
      </CardContent></Card>
    </div>
  );
}
