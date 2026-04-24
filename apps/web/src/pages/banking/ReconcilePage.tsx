import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney, parseMoneyInput } from '@/lib/money';

type BankAccount = {
  id: string;
  business_id: string;
  name: string;
  institution: string | null;
  account_last_four: string | null;
  cash_account_id: string;
  is_active: boolean;
};

type Reconciliation = {
  id: string;
  business_id: string;
  bank_account_id: string;
  period_start: string;
  period_end: string;
  statement_ending_balance: string;
  reconciled_at: string;
  reconciled_by_user_id: string | null;
  memo: string | null;
};

type BankTransactionStatus = 'unreviewed' | 'matched' | 'categorized' | 'excluded';

type BankTransaction = {
  id: string;
  business_id: string;
  bank_account_id: string;
  transaction_date: string;
  description: string;
  amount: string;
  status: BankTransactionStatus;
  is_reconciled: boolean;
};

function pickErr(e: unknown): string {
  const resp = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
  if (resp) return resp;
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

function inRange(date: string, start: string, end: string): boolean {
  if (!start || !end) return false;
  return date >= start && date <= end;
}

export default function ReconcilePage() {
  const [bizId] = useActiveBusinessId();
  const today = new Date().toISOString().slice(0, 10);

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState<string>('');

  const [priorRecs, setPriorRecs] = useState<Reconciliation[]>([]);
  const [unreviewed, setUnreviewed] = useState<BankTransaction[]>([]);
  const [reviewedUnrecon, setReviewedUnrecon] = useState<BankTransaction[]>([]);

  const [form, setForm] = useState({
    period_start: '',
    period_end: today,
    statement_ending_balance: '0.00',
    memo: '',
  });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load bank accounts when biz changes.
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/bank-accounts`)
      .then(r => {
        const list: BankAccount[] = r.data.bank_accounts;
        setBankAccounts(list);
        setBankAccountId(prev => prev && list.some(b => b.id === prev) ? prev : (list[0]?.id ?? ''));
      })
      .catch((e: unknown) => setErr(pickErr(e)));
  }, [bizId]);

  // Load prior reconciliations + transactions for the selected bank account.
  useEffect(() => {
    if (!bizId || !bankAccountId) {
      setPriorRecs([]);
      setUnreviewed([]);
      setReviewedUnrecon([]);
      return;
    }
    setErr(null);
    api.get(`/businesses/${bizId}/reconciliations`, { params: { bank_account_id: bankAccountId } })
      .then(r => setPriorRecs(r.data.reconciliations as Reconciliation[]))
      .catch((e: unknown) => setErr(pickErr(e)));
    // Unreviewed txns for this bank account (client-side date filter applied in memo).
    api.get(`/businesses/${bizId}/bank-transactions`, {
      params: { bank_account_id: bankAccountId, status: 'unreviewed' },
    })
      .then(r => setUnreviewed(r.data.bank_transactions as BankTransaction[]))
      .catch((e: unknown) => setErr(pickErr(e)));
    // Reviewed-but-not-yet-reconciled txns (status=matched OR status=categorized AND is_reconciled=false).
    Promise.all([
      api.get(`/businesses/${bizId}/bank-transactions`, {
        params: { bank_account_id: bankAccountId, status: 'matched', is_reconciled: false },
      }),
      api.get(`/businesses/${bizId}/bank-transactions`, {
        params: { bank_account_id: bankAccountId, status: 'categorized', is_reconciled: false },
      }),
    ])
      .then(([m, c]) => {
        const rows: BankTransaction[] = [
          ...(m.data.bank_transactions as BankTransaction[]),
          ...(c.data.bank_transactions as BankTransaction[]),
        ];
        setReviewedUnrecon(rows);
      })
      .catch((e: unknown) => setErr(pickErr(e)));
  }, [bizId, bankAccountId]);

  const { unreviewedInRange, reviewedInRange } = useMemo(() => ({
    unreviewedInRange: unreviewed.filter(t => inRange(t.transaction_date, form.period_start, form.period_end)),
    reviewedInRange: reviewedUnrecon.filter(t => inRange(t.transaction_date, form.period_start, form.period_end)),
  }), [unreviewed, reviewedUnrecon, form.period_start, form.period_end]);

  const priorTop10 = priorRecs.slice(0, 10);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !bankAccountId) return;
    if (unreviewedInRange.length > 0) return;
    if (!form.period_start || !form.period_end) {
      setErr('Period start and end are required');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const body = {
        bank_account_id: bankAccountId,
        period_start: form.period_start,
        period_end: form.period_end,
        statement_ending_balance: parseMoneyInput(form.statement_ending_balance),
        memo: form.memo.trim() ? form.memo.trim() : null,
      };
      const r = await api.post(`/businesses/${bizId}/reconciliations`, body);
      const created: Reconciliation = r.data;
      setPriorRecs(prev => [created, ...prev]);
      // Reset form (keep bank account selection).
      setForm({ period_start: '', period_end: today, statement_ending_balance: '0.00', memo: '' });
      // The submitted txns just became reconciled — remove them from reviewed-unreconciled cache.
      setReviewedUnrecon(prev => prev.filter(t => !inRange(t.transaction_date, created.period_start, created.period_end)));
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  const datesValid = !!form.period_start && !!form.period_end && form.period_start <= form.period_end;
  const canSubmit = datesValid && unreviewedInRange.length === 0 && !busy && !!bankAccountId;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reconcile</h1>
        <div className="min-w-[16rem]">
          <Label>Bank account</Label>
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={bankAccountId}
            onChange={e => setBankAccountId(e.target.value)}
          >
            <option value="">Select…</option>
            {bankAccounts.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}{b.account_last_four ? ` •••${b.account_last_four}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Prior reconciliations</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-left p-3">Period</th>
                <th className="text-right p-3">Statement ending balance</th>
                <th className="text-left p-3">Reconciled at</th>
                <th className="text-left p-3">Memo</th>
              </tr>
            </thead>
            <tbody>
              {priorTop10.length === 0 && (
                <tr><td className="p-3 text-muted-foreground" colSpan={4}>No prior reconciliations for this account.</td></tr>
              )}
              {priorTop10.map(r => (
                <tr key={r.id} className="border-b last:border-b-0">
                  <td className="p-3">{r.period_start} — {r.period_end}</td>
                  <td className="p-3 text-right">{fmtMoney(r.statement_ending_balance)}</td>
                  <td className="p-3">{new Date(r.reconciled_at).toLocaleString()}</td>
                  <td className="p-3">{r.memo ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <form onSubmit={submit}>
        <Card>
          <CardHeader><CardTitle>New reconciliation</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-4 gap-3">
            <div>
              <Label>Period start</Label>
              <Input
                type="date"
                value={form.period_start}
                onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Period end</Label>
              <Input
                type="date"
                value={form.period_end}
                onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Statement ending balance</Label>
              <Input
                type="number"
                step="0.01"
                value={form.statement_ending_balance}
                onChange={e => setForm(f => ({ ...f, statement_ending_balance: e.target.value }))}
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <Label>Memo</Label>
              <Input
                value={form.memo}
                onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 space-y-3">
          <Card>
            <CardHeader><CardTitle>Preflight check</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!datesValid ? (
                <p className="text-muted-foreground">Enter a valid period to see the preflight summary.</p>
              ) : (
                <>
                  <p>
                    <span className={unreviewedInRange.length > 0 ? 'font-semibold text-destructive' : 'font-semibold text-emerald-600'}>
                      {unreviewedInRange.length} unreviewed
                    </span>
                    {' '}transaction{unreviewedInRange.length === 1 ? '' : 's'} in this period.{' '}
                    <Link
                      className="text-primary underline"
                      to={`/accounting/bank-transactions?bank_account_id=${bankAccountId}&status=unreviewed`}
                    >
                      Open inbox
                    </Link>
                  </p>
                  <p className="text-muted-foreground">
                    {reviewedInRange.length} reviewed transaction{reviewedInRange.length === 1 ? '' : 's'} will be marked reconciled.
                  </p>
                  {unreviewedInRange.length > 0 && (
                    <p className="text-xs text-destructive">Resolve unreviewed transactions before reconciling.</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button type="submit" disabled={!canSubmit}>
              {busy ? 'Reconciling…' : 'Create reconciliation'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
