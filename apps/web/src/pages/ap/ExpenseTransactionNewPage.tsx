import { useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from '@/lib/paymentMethods';

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
type Vendor = { id: string; name: string };
type CreatedExpense = { id: string };

type CreateBody = {
  transaction_date: string;
  payee_text: string | null;
  vendor_id: string | null;
  expense_account_id: string;
  payment_account_id: string;
  payment_method: PaymentMethod;
  amount: string;
  memo: string | null;
};

type ExpenseForm = {
  transaction_date: string;
  payee_text: string;
  expense_account_id: string;
  payment_account_id: string;
  payment_method: PaymentMethod | '';
  amount: string;
  memo: string;
};

const AMOUNT_RE = /^\d+(\.\d+)?$/;

function today(): string {
  return todayLocal();
}

export default function ExpenseTransactionNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [form, setForm] = useState<ExpenseForm>({
    transaction_date: today(),
    payee_text: '',
    expense_account_id: '',
    payment_account_id: '',
    payment_method: '',
    amount: '',
    memo: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get<CoaResponse>(`/businesses/${bizId}/coa`).then((r) => setAccounts(r.data.accounts));
    api.get(`/businesses/${bizId}/vendors`).then((r) => setVendors(r.data.vendors));
  }, [bizId]);

  const paymentAccounts = useMemo(
    () => accounts.filter((a) => (a.account_type === 'asset' || a.account_type === 'liability') && a.is_active),
    [accounts],
  );
  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === 'expense' && a.is_active),
    [accounts],
  );

  const amountNum = Number(form.amount) || 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!AMOUNT_RE.test(form.amount)) { setErr('Amount must be a positive number like 125.00'); return; }
    if (!form.payment_method) { setErr('Choose a payment method'); return; }
    setBusy(true);
    try {
      // QBO payee combo: an exact vendor-name match links the vendor, otherwise free text.
      const vendor = vendors.find((v) => v.name.toLowerCase() === form.payee_text.trim().toLowerCase());
      const body: CreateBody = {
        transaction_date: form.transaction_date,
        payee_text: vendor ? null : (form.payee_text || null),
        vendor_id: vendor?.id ?? null,
        expense_account_id: form.expense_account_id,
        payment_account_id: form.payment_account_id,
        payment_method: form.payment_method,
        amount: form.amount,
        memo: form.memo || null,
      };
      const r = await api.post<CreatedExpense>(`/businesses/${bizId}/expense-transactions`, body);
      nav(`/ap/expenses/${r.data.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    } finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6" onSubmit={submit}>
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold">Expense</h1>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount</div>
          <div className="text-3xl font-semibold font-mono">{fmtMoney(String(amountNum))}</div>
        </div>
      </div>

      <Card><CardContent className="grid grid-cols-1 gap-3 pt-6 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label className="text-xs text-muted-foreground">Payee</Label>
          <Input
            list="expense-payees"
            value={form.payee_text}
            onChange={(e) => setForm((f) => ({ ...f, payee_text: e.target.value }))}
            placeholder="Who did you pay?"
            required
          />
          <datalist id="expense-payees">
            {vendors.map((v) => <option key={v.id} value={v.name} />)}
          </datalist>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Payment account</Label>
          <AccountSelect
            accounts={paymentAccounts}
            value={form.payment_account_id}
            onChange={(id) => setForm((f) => ({ ...f, payment_account_id: id }))}
            required
            placeholder="Which account paid?"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Payment method</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.payment_method}
            onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value as PaymentMethod | '' }))}
            required
          >
            <option value="">Choose payment method</option>
            {PAYMENT_METHOD_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Payment date</Label>
          <DateInput
            value={form.transaction_date}
            onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value }))}
            required
          />
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <div className="border-b px-6 py-3 text-sm font-semibold">Category details</div>
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="w-10 p-3 text-left">#</th>
              <th className="p-3 text-left">Category</th>
              <th className="p-3 text-left">Description</th>
              <th className="w-40 p-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p-3 text-muted-foreground">1</td>
              <td className="p-3">
                <AccountSelect
                  accounts={expenseAccounts}
                  value={form.expense_account_id}
                  onChange={(id) => setForm((f) => ({ ...f, expense_account_id: id }))}
                  required
                  placeholder="Choose category…"
                />
              </td>
              <td className="p-3">
                <Input value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} placeholder="What did you pay for?" />
              </td>
              <td className="p-3">
                <Input
                  type="number" step="0.01" inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00" required
                  className="text-right font-mono"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div className="flex justify-end gap-12 border-t px-6 py-4 text-sm font-semibold">
          <span>Total</span>
          <span className="font-mono">{fmtMoney(String(amountNum))}</span>
        </div>
      </CardContent></Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex items-center gap-2 sticky bottom-0 border-t bg-background py-3">
        <Button type="button" variant="outline" onClick={() => nav('/ap/expenses')}>Cancel</Button>
        <div className="flex-1" />
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</Button>
      </div>
    </form>
  );
}
