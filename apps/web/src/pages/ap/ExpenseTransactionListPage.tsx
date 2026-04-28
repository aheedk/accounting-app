import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import type { Role } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
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
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Payee</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No expense transactions match the current filter.</td></tr>
            )}
            {items.map(t => (
              <tr key={t.id} className="border-b last:border-b-0">
                <td className="p-3">{t.transaction_date}</td>
                <td className="p-3">{t.payee_text ?? '(vendor)'}</td>
                <td className="p-3 text-right font-mono">{fmtMoney(t.amount)}</td>
                <td className="p-3">{statusBadge(t.status)}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    <Link to={`/ap/expenses/${t.id}`} className="text-primary underline text-xs">View</Link>
                    {canMutate && t.status === 'draft' && (
                      <Button size="sm" variant="outline" onClick={() => postExpense(t)} disabled={busy}>Post</Button>
                    )}
                    {canMutate && (t.status === 'draft' || t.status === 'posted') && (
                      <Button size="sm" variant="ghost" onClick={() => voidExpense(t)} disabled={busy}>Void</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
