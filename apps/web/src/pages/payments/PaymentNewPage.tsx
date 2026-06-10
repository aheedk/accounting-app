import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { fmtMoney, parseMoneyInput } from '@/lib/money';

type Customer = { id: string; name: string };
type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };
type InvoiceSummary = { id: string; invoice_number: string; issue_date: string; due_date: string; status: string; total: string };
type OutstandingRow = { invoice_id: string; invoice_number: string; due_date: string; original_amount: string; open_balance: string };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function PaymentNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cashAccounts, setCashAccounts] = useState<Account[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    customer_id: params.get('customer_id') ?? '',
    payment_date: today,
    payment_method: 'check',
    reference: '',
    amount: '',
    cash_account_id: '',
    memo: '',
  });
  const [outstanding, setOutstanding] = useState<OutstandingRow[]>([]);
  // payment amount keyed by invoice id; missing/empty = not applied
  const [payments, setPayments] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
    api.get(`/businesses/${bizId}/coa`).then(r => setCashAccounts(r.data.accounts.filter((a: Account) => a.account_type === 'asset' && a.is_active && a.code.startsWith('10'))));
  }, [bizId]);

  // Load the customer's posted invoices with open balances (QBO "Outstanding Transactions").
  useEffect(() => {
    if (!bizId || !form.customer_id) { setOutstanding([]); setPayments({}); return; }
    let cancelled = false;
    (async () => {
      const r = await api.get(`/businesses/${bizId}/invoices`, { params: { customer_id: form.customer_id, status: 'posted' } });
      const invoices: InvoiceSummary[] = r.data.invoices;
      const details = await Promise.all(invoices.map(i => api.get(`/businesses/${bizId}/invoices/${i.id}`)));
      if (cancelled) return;
      const rows: OutstandingRow[] = invoices.map((inv, idx) => ({
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        due_date: inv.due_date,
        original_amount: inv.total,
        open_balance: details[idx]?.data.amount_due ?? inv.total,
      })).filter(r2 => Number(r2.open_balance) > 0);
      setOutstanding(rows);
      // Pre-apply the invoice passed via ?invoice_id= (QBO "receive payment" from an invoice).
      const preselect = params.get('invoice_id');
      if (preselect) {
        const row = rows.find(r2 => r2.invoice_id === preselect);
        if (row) setPayments({ [row.invoice_id]: row.open_balance });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizId, form.customer_id]);

  const appliedTotal = useMemo(
    () => Object.values(payments).reduce((s, v) => s + (Number(v) || 0), 0),
    [payments],
  );
  const customerBalance = useMemo(
    () => outstanding.reduce((s, r) => s + Number(r.open_balance), 0),
    [outstanding],
  );
  const amountReceived = form.amount !== '' ? Number(form.amount) || 0 : appliedTotal;

  function togglePayment(row: OutstandingRow) {
    setPayments(p => {
      const n = { ...p };
      if (n[row.invoice_id] !== undefined) delete n[row.invoice_id];
      else n[row.invoice_id] = row.open_balance;
      return n;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const initial_applications = Object.entries(payments)
        .filter(([, v]) => Number(v) > 0)
        .map(([invoice_id, v]) => ({ invoice_id, applied_amount: parseMoneyInput(v) }));
      const body = {
        customer_id: form.customer_id,
        payment_date: form.payment_date,
        payment_method: form.payment_method,
        reference: form.reference || null,
        amount: parseMoneyInput(String(amountReceived)),
        cash_account_id: form.cash_account_id,
        memo: form.memo || null,
        ...(initial_applications.length > 0 ? { initial_applications } : {}),
      };
      const r = await api.post(`/businesses/${bizId}/payments`, body);
      nav(`/payments/${r.data.payment.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6" onSubmit={submit}>
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold">Receive Payment</h1>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount received</div>
          <div className="text-3xl font-semibold font-mono">{fmtMoney(String(amountReceived))}</div>
          <div className="mt-1 text-xs text-muted-foreground">Customer balance <span className="font-mono">{fmtMoney(String(customerBalance))}</span></div>
        </div>
      </div>

      <div className="max-w-sm">
        <Label className="text-xs text-muted-foreground">Customer</Label>
        <select
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={form.customer_id}
          onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}
          required
        >
          <option value="">Choose a customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-base">Record payment</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs text-muted-foreground">Payment date</Label><DateInput value={form.payment_date} onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} required /></div>
            <div><Label className="text-xs text-muted-foreground">Reference no.</Label><Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="Check #, transaction ID, etc." /></div>
            <div><Label className="text-xs text-muted-foreground">Payment method</Label>
              <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}>
                {['cash', 'check', 'ach', 'wire', 'card', 'other'].map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div><Label className="text-xs text-muted-foreground">Deposit to</Label>
              <AccountSelect
                accounts={cashAccounts}
                value={form.cash_account_id}
                onChange={(id) => setForm(f => ({ ...f, cash_account_id: id }))}
                required
                placeholder="Search cash account…"
              />
            </div>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">Amount</CardTitle></CardHeader>
          <CardContent>
            <Label className="text-xs text-muted-foreground">Amount received</Label>
            <Input
              type="number" step="0.01" inputMode="decimal"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              placeholder={String(appliedTotal.toFixed(2))}
              className="text-right font-mono"
            />
            <p className="mt-2 text-xs text-muted-foreground">Leave blank to use the sum of applied payments.</p>
          </CardContent>
        </Card>
      </div>

      {form.customer_id && (
        <Card><CardHeader><CardTitle className="text-base">Outstanding transactions</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 p-3"></th>
                  <th className="p-3 text-left">Description</th>
                  <th className="p-3 text-left">Due date</th>
                  <th className="p-3 text-right">Original amount</th>
                  <th className="p-3 text-right">Open balance</th>
                  <th className="p-3 text-right">Payment</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map(r => (
                  <tr key={r.invoice_id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3">
                      <input type="checkbox" checked={payments[r.invoice_id] !== undefined} onChange={() => togglePayment(r)} aria-label={`Apply to invoice ${r.invoice_number}`} />
                    </td>
                    <td className="p-3">Invoice <span className="font-mono">{r.invoice_number}</span></td>
                    <td className="p-3 whitespace-nowrap">{fmtShortDate(r.due_date)}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(r.original_amount)}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(r.open_balance)}</td>
                    <td className="p-3 text-right">
                      <Input
                        type="number" step="0.01" inputMode="decimal"
                        className="ml-auto w-32 text-right font-mono"
                        value={payments[r.invoice_id] ?? ''}
                        onChange={e => setPayments(p => ({ ...p, [r.invoice_id]: e.target.value }))}
                        placeholder="0.00"
                      />
                    </td>
                  </tr>
                ))}
                {outstanding.length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No open invoices for this customer.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="max-w-md">
        <Label className="text-xs text-muted-foreground">Memo</Label>
        <textarea
          value={form.memo}
          onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
          rows={3}
          placeholder="Note"
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <div className="mt-2 text-xs text-muted-foreground">Attachments coming soon.</div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex items-center gap-2 sticky bottom-0 border-t bg-background py-3">
        <Button type="button" variant="outline" onClick={() => nav('/payments')}>Cancel</Button>
        <div className="flex-1" />
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</Button>
      </div>
    </form>
  );
}
