import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileText, Trash2 } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import type { Role } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailActivity, DetailField, DetailMetric, DetailPageHeader, baseDetailMenuActions } from '@/components/ui/detail-page';
import { fmtDateTime, fmtLongDate } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';
import { paymentMethodLabel, type PaymentMethod } from '@/lib/paymentMethods';

type ExpenseStatus = 'draft' | 'posted' | 'void';

type ExpenseTransaction = {
  id: string;
  business_id: string;
  transaction_date: string;
  payee_text: string | null;
  vendor_id: string | null;
  expense_account_id: string;
  payment_account_id: string;
  payment_method: PaymentMethod;
  amount: string;
  memo: string | null;
  status: ExpenseStatus;
  journal_entry_id: string | null;
  posted_at: string | null;
  voided_at: string | null;
  created_at?: string;
  updated_at?: string;
};

type Vendor = { id: string; name: string };
type Account = { id: string; code: string; name: string; account_type: string };

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


export default function ExpenseTransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const { user } = useAuth();
  const canMutate = roleAtLeast(user?.role, 'accountant');

  const [data, setData] = useState<ExpenseTransaction | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!bizId || !id) return;
    setErr(null);
    try {
      const r = await api.get<ExpenseTransaction>(`/businesses/${bizId}/expense-transactions/${id}`);
      setData(r.data);
      if (r.data.vendor_id) {
        try {
          const v = await api.get<Vendor>(`/businesses/${bizId}/vendors/${r.data.vendor_id}`);
          setVendor(v.data);
        } catch {
          setVendor(null);
        }
      } else {
        setVendor(null);
      }
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }, [bizId, id]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/coa`, { params: { include_inactive: true } }).then(r => setAccounts(r.data.accounts)).catch(() => setAccounts([]));
  }, [bizId]);

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

  const accountMap = useMemo(() => new Map(accounts.map(a => [a.id, `${a.code} - ${a.name}`])), [accounts]);

  if (!bizId) return <div>Pick a business.</div>;
  if (err && !data) return <div className="text-sm text-destructive">{err}</div>;
  if (!data) return <div>Loading...</div>;

  const payeeName = vendor?.name ?? data.payee_text ?? 'No payee';
  const canPost = canMutate && data.status === 'draft';
  const canVoid = canMutate && (data.status === 'draft' || data.status === 'posted');

  return (
    <div className="space-y-6">
      <DetailPageHeader
        eyebrow="Expense transaction"
        title={payeeName}
        subtitle={fmtLongDate(data.transaction_date)}
        status={data.status}
        totalLabel="Amount"
        total={fmtMoney(data.amount)}
        actions={canPost ? [{ label: busy ? 'Posting...' : 'Post expense', icon: <FileText className="h-4 w-4" />, onClick: post, disabled: busy }] : []}
        menuActions={[
          ...baseDetailMenuActions(),
          ...(canVoid ? [{ label: 'Void expense', icon: <Trash2 className="h-4 w-4" />, onSelect: voidExpense, destructive: true, disabled: busy }] : []),
        ]}
      />

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <DetailMetric label="Expense date" value={fmtLongDate(data.transaction_date)} />
        <DetailMetric label="Expense account" value={accountMap.get(data.expense_account_id) ?? data.expense_account_id.slice(0, 8)} />
        <DetailMetric label="Paid from" value={accountMap.get(data.payment_account_id) ?? data.payment_account_id.slice(0, 8)} />
        <DetailMetric label="Payment method" value={paymentMethodLabel(data.payment_method)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Payee" value={vendor ? <Link className="text-primary hover:underline" to={`/ap/vendors/${vendor.id}`}>{vendor.name}</Link> : data.payee_text} />
            <DetailField label="Transaction date" value={fmtLongDate(data.transaction_date)} />
            <DetailField label="Expense account" value={accountMap.get(data.expense_account_id) ?? data.expense_account_id.slice(0, 8)} />
            <DetailField label="Payment account" value={accountMap.get(data.payment_account_id) ?? data.payment_account_id.slice(0, 8)} />
            <DetailField label="Payment method" value={paymentMethodLabel(data.payment_method)} />
            <DetailField label="Memo" className="sm:col-span-2" value={data.memo} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <CardContent>
            <DetailActivity
              items={[
                { label: 'Created', value: data.created_at ? fmtDateTime(data.created_at) : null },
                { label: 'Last updated', value: data.updated_at ? fmtDateTime(data.updated_at) : null },
                { label: 'Posted', value: data.posted_at ? fmtDateTime(data.posted_at) : null },
                { label: 'Voided', value: data.voided_at ? fmtDateTime(data.voided_at) : null },
                {
                  label: 'Journal entry',
                  value: data.journal_entry_id
                    ? <Link to={`/journal/${data.journal_entry_id}`} className="font-mono text-primary hover:underline">JE {data.journal_entry_id.slice(0, 8)}</Link>
                    : null,
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Button variant="outline" onClick={() => nav('/ap/expenses')}>Back to expenses</Button>
    </div>
  );
}
