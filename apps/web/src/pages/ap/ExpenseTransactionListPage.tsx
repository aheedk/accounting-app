import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import type { Role } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { fmtMoney } from '@/lib/money';

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
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'posted', label: 'Posted' },
  { value: 'void', label: 'Void' },
];

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

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [items, setItems] = useState<ExpenseTransaction[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!bizId) { setItems([]); return; }
    setLoading(true);
    setErr(null);
    try {
      const params: { status?: ExpenseStatus } = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      const r = await api.get<ListResponse>(`/businesses/${bizId}/expense-transactions`, { params });
      setItems(r.data.expense_transactions);
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setLoading(false);
    }
  }, [bizId, statusFilter]);

  useEffect(() => { reload(); }, [reload]);

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

  const columns: Column<ExpenseTransaction>[] = [
    {
      key: 'transaction_date',
      header: 'Date',
      sortable: true,
      sortValue: r => Date.parse(r.transaction_date) || 0,
      render: r => <span className="whitespace-nowrap">{fmtShortDate(r.transaction_date)}</span>,
    },
    {
      key: 'payee',
      header: 'Payee',
      sortable: true,
      sortValue: r => r.payee_text ?? '',
      render: r => r.payee_text ?? <span className="text-muted-foreground">(vendor)</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      sortValue: r => Number(r.amount),
      render: r => <span className="font-mono">{fmtMoney(r.amount)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.status,
      render: r => statusBadge(r.status),
    },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Expense Transactions</h1>
        <Button asChild><Link to="/ap/expenses/new">+ New Expense</Link></Button>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
          <div>
            <Label>Status</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            >
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <Button type="button" variant="outline" onClick={() => reload()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card><CardContent className="p-0">
        <DataTable
          rows={items}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="transaction_date"
          defaultSortDir="desc"
          downloadable={{ filename: 'expense-transactions', title: 'Expense Transactions' }}
          actions={r => (
            <span className="inline-flex flex-wrap items-center gap-1">
              <Link to={`/ap/expenses/${r.id}`} className="text-primary underline text-xs">View</Link>
              {canMutate && r.status === 'draft' && (
                <Button size="sm" variant="outline" onClick={() => postExpense(r)} disabled={busy}>Post</Button>
              )}
              {canMutate && (r.status === 'draft' || r.status === 'posted') && (
                <Button size="sm" variant="ghost" onClick={() => voidExpense(r)} disabled={busy}>Void</Button>
              )}
            </span>
          )}
          emptyMessage="No expense transactions match the current filter."
        />
      </CardContent></Card>
    </div>
  );
}
