import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import type { Role } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type ExpenseStatus = 'draft' | 'posted' | 'void';

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
  posted_at: string | null;
  voided_at: string | null;
  created_at?: string;
  updated_at?: string;
};

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

export default function ExpenseTransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const { user } = useAuth();
  const canMutate = roleAtLeast(user?.role, 'accountant');

  const [data, setData] = useState<ExpenseTransaction | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!bizId || !id) return;
    setErr(null);
    try {
      const r = await api.get<ExpenseTransaction>(`/businesses/${bizId}/expense-transactions/${id}`);
      setData(r.data);
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }, [bizId, id]);

  useEffect(() => { reload(); }, [reload]);

  async function post() {
    if (!bizId || !id) return;
    if (!window.confirm('Post this expense to the ledger?')) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/expense-transactions/${id}/post`);
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function voidExpense() {
    if (!bizId || !id) return;
    if (!window.confirm('Void this expense? This cannot be undone.')) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/expense-transactions/${id}/void`);
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;
  if (err && !data) return <div className="text-sm text-destructive">{err}</div>;
  if (!data) return <div>Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Expense Transaction</h1>
          <p className="text-xs text-muted-foreground font-mono">{data.id}</p>
        </div>
        {statusBadge(data.status)}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>Date: {data.transaction_date}</div>
          <div>Amount: <span className="font-mono">{fmtMoney(data.amount)}</span></div>
          <div className="col-span-2">Payee: {data.payee_text ?? '—'}</div>
          <div className="col-span-2 font-mono text-xs text-muted-foreground">
            Vendor: {data.vendor_id ?? '—'}
          </div>
          <div className="col-span-2 font-mono text-xs text-muted-foreground">
            Expense account: {data.expense_account_id}
          </div>
          <div className="col-span-2 font-mono text-xs text-muted-foreground">
            Payment account: {data.payment_account_id}
          </div>
          <div className="col-span-2">Memo: {data.memo ?? '—'}</div>
          <div className="col-span-2">
            Journal entry:{' '}
            {data.journal_entry_id ? (
              <Link to={`/journal/${data.journal_entry_id}`} className="text-primary underline font-mono text-xs">
                JE {data.journal_entry_id.slice(0, 8)}
              </Link>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
          {data.posted_at && (
            <div className="col-span-2 text-xs text-muted-foreground">Posted at: {data.posted_at}</div>
          )}
          {data.voided_at && (
            <div className="col-span-2 text-xs text-muted-foreground">Voided at: {data.voided_at}</div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        {canMutate && data.status === 'draft' && (
          <Button onClick={post} disabled={busy}>{busy ? 'Posting…' : 'Post'}</Button>
        )}
        {canMutate && (data.status === 'draft' || data.status === 'posted') && (
          <Button variant="outline" onClick={voidExpense} disabled={busy}>{busy ? 'Voiding…' : 'Void'}</Button>
        )}
        <Button variant="outline" onClick={() => nav('/ap/expenses')}>Back to list</Button>
      </div>
    </div>
  );
}
