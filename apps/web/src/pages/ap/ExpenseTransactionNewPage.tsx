import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AccountSelect } from '@/components/ui/AccountSelect';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  is_system: boolean;
  is_active: boolean;
};

type CoaResponse = { accounts: Account[] };

type CreatedExpense = { id: string };

type CreateBody = {
  transaction_date: string;
  payee_text: string | null;
  expense_account_id: string;
  payment_account_id: string;
  amount: string;
  memo: string | null;
};

const AMOUNT_RE = /^\d+(\.\d+)?$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpenseTransactionNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({
    transaction_date: today(),
    payee_text: '',
    expense_account_id: '',
    payment_account_id: '',
    amount: '',
    memo: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get<CoaResponse>(`/businesses/${bizId}/coa`).then((r) => setAccounts(r.data.accounts));
  }, [bizId]);

  const expenseAccounts = accounts.filter((a) => a.account_type === 'expense' && a.is_active);
  const paymentAccounts = accounts.filter(
    (a) => (a.account_type === 'asset' || a.account_type === 'liability') && a.is_active,
  );

  function buildBody(): CreateBody {
    if (!AMOUNT_RE.test(form.amount)) {
      throw new Error('Amount must be a positive number (e.g. 42.50)');
    }
    if (!form.expense_account_id) throw new Error('Expense account is required');
    if (!form.payment_account_id) throw new Error('Payment account is required');
    if (!form.payee_text.trim()) throw new Error('Payee is required');
    return {
      transaction_date: form.transaction_date,
      payee_text: form.payee_text.trim() === '' ? null : form.payee_text.trim(),
      expense_account_id: form.expense_account_id,
      payment_account_id: form.payment_account_id,
      amount: form.amount,
      memo: form.memo.trim() === '' ? null : form.memo.trim(),
    };
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body = buildBody();
      await api.post<CreatedExpense>(`/businesses/${bizId}/expense-transactions`, body);
      nav('/ap/expenses');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message ??
        (e instanceof Error ? e.message : undefined);
      setErr(msg ?? 'Failed to create expense');
    } finally {
      setBusy(false);
    }
  }

  async function saveAndPost() {
    setErr(null);
    setBusy(true);
    try {
      const body = buildBody();
      const r = await api.post<CreatedExpense>(`/businesses/${bizId}/expense-transactions`, body);
      await api.post(`/businesses/${bizId}/expense-transactions/${r.data.id}/post`);
      nav('/ap/expenses');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message ??
        (e instanceof Error ? e.message : undefined);
      setErr(msg ?? 'Failed to create or post expense');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <form className="space-y-6 max-w-2xl" onSubmit={saveDraft}>
      <h1 className="text-2xl font-semibold">New Expense Transaction</h1>
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div>
            <Label>Date</Label>
            <Input
              type="date"
              value={form.transaction_date}
              onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value }))}
              required
            />
          </div>
          <div>
            <Label>Amount</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="42.50"
              className="text-right font-mono"
              required
            />
          </div>
          <div className="col-span-2">
            <Label>Payee</Label>
            <Input
              value={form.payee_text}
              onChange={(e) => setForm((f) => ({ ...f, payee_text: e.target.value }))}
              placeholder="Vendor or payee name"
              required
            />
          </div>
          <div>
            <Label>Expense account (debit)</Label>
            <AccountSelect
              accounts={expenseAccounts}
              value={form.expense_account_id}
              onChange={(id) => setForm((f) => ({ ...f, expense_account_id: id }))}
              required
              placeholder="Search expense account…"
            />
          </div>
          <div>
            <Label>Payment account (credit)</Label>
            <AccountSelect
              accounts={paymentAccounts}
              value={form.payment_account_id}
              onChange={(id) => setForm((f) => ({ ...f, payment_account_id: id }))}
              required
              placeholder="Search cash or credit account…"
            />
          </div>
          <div className="col-span-2">
            <Label>Memo</Label>
            <Input
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
              placeholder="Optional note"
            />
          </div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save draft'}
        </Button>
        <Button type="button" onClick={saveAndPost} disabled={busy}>
          {busy ? 'Saving…' : 'Save & Post'}
        </Button>
        <Button type="button" variant="outline" onClick={() => nav('/ap/expenses')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
