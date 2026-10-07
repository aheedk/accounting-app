import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { DateInput } from '@/components/ui/date-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { AppSelect } from '../../components/ui/select';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { flashMessage } from '@/lib/flash';
import { statementBankAccounts } from '@/lib/bankAccountOptions';

type UnpaidBill = {
  bill_id: string; bill_number: string; vendor_id: string; vendor_name: string;
  bill_date: string; due_date: string; total: string; open_balance: string;
};
type Account = { id: string; code: string; name: string; account_type: string; detail_type?: string | null; is_active: boolean };

const METHODS = [
  { value: 'check', label: 'Check' },
  { value: 'ach', label: 'ACH' },
  { value: 'wire', label: 'Wire' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
] as const;

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${Number(m)}/${Number(d)}/${y.slice(2)}` : iso;
}

// Pay Bills, as in QuickBooks: every unpaid bill of every vendor on one screen.
// Tick the ones to pay; one payment per vendor is recorded and posted.
export default function PayBillsPage() {
  const [bizId] = useActiveBusinessId();
  const [bills, setBills] = useState<UnpaidBill[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bankingIds, setBankingIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // bill id -> amount to pay; a bill is selected when it has an entry.
  const [payments, setPayments] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ cash_account_id: '', payment_date: todayLocal(), payment_method: 'check', reference: '' });
  const [vendorFilter, setVendorFilter] = useState('');
  const today = todayLocal();

  const load = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    try {
      const [billsRes, coaRes, bankRes] = await Promise.all([
        api.get<{ bills: UnpaidBill[] }>(`/businesses/${bizId}/unpaid-bills`),
        api.get<{ accounts: Account[] }>(`/businesses/${bizId}/coa`),
        api.get<{ bank_accounts: Array<{ cash_account_id: string }> }>(`/businesses/${bizId}/bank-accounts`)
          .then(r => r.data.bank_accounts ?? []).catch(() => []),
      ]);
      setBills(billsRes.data.bills);
      setAccounts(coaRes.data.accounts.filter(a => a.is_active));
      setBankingIds(new Set(bankRes.map(b => b.cash_account_id)));
      setPayments({});
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setLoading(false);
    }
  }, [bizId]);

  useEffect(() => { void load(); }, [load]);

  const payFrom = useMemo(
    () => statementBankAccounts(accounts, bankingIds, form.cash_account_id),
    [accounts, bankingIds, form.cash_account_id],
  );
  // The only account to pay from needs no choosing.
  useEffect(() => {
    if (form.cash_account_id === '' && payFrom.length === 1) setForm(f => ({ ...f, cash_account_id: payFrom[0]!.id }));
  }, [payFrom, form.cash_account_id]);

  const shown = useMemo(() => {
    const q = vendorFilter.trim().toLowerCase();
    return q ? bills.filter(b => b.vendor_name.toLowerCase().includes(q) || b.bill_number.toLowerCase().includes(q)) : bills;
  }, [bills, vendorFilter]);

  const selected = bills.filter(b => payments[b.bill_id] !== undefined);
  const total = selected.reduce((sum, b) => sum + (Number(payments[b.bill_id]) || 0), 0);
  const vendorCount = new Set(selected.map(b => b.vendor_id)).size;
  const overpaid = selected.find(b => (Number(payments[b.bill_id]) || 0) > Number(b.open_balance) + 0.005);
  const blank = selected.find(b => !(Number(payments[b.bill_id]) > 0));
  const ready = selected.length > 0 && !overpaid && !blank && form.cash_account_id !== '';

  function toggle(bill: UnpaidBill) {
    setPayments(prev => {
      const next = { ...prev };
      if (next[bill.bill_id] !== undefined) delete next[bill.bill_id];
      else next[bill.bill_id] = Number(bill.open_balance).toFixed(2);
      return next;
    });
  }
  function toggleAllShown(on: boolean) {
    setPayments(prev => {
      const next = { ...prev };
      for (const bill of shown) {
        if (on) next[bill.bill_id] ??= Number(bill.open_balance).toFixed(2);
        else delete next[bill.bill_id];
      }
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !ready) return;
    setErr(null); setBusy(true);
    try {
      const r = await api.post<{ bill_payments: Array<{ id: string }> }>(`/businesses/${bizId}/bill-payments/batch`, {
        payment_date: form.payment_date,
        payment_method: form.payment_method,
        cash_account_id: form.cash_account_id,
        reference: form.reference.trim() || null,
        items: selected.map(b => ({ bill_id: b.bill_id, amount: parseMoneyInput(payments[b.bill_id] ?? '0') })),
      });
      const made = r.data.bill_payments.length;
      flashMessage(`Paid ${selected.length} bill${selected.length === 1 ? '' : 's'} with ${made} payment${made === 1 ? '' : 's'}`);
      await load();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6" onSubmit={submit}>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pay Bills</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tick the bills to pay. One payment is recorded for each vendor.{' '}
            <Link className="text-primary hover:underline" to="/ap/bill-payments">Past payments</Link>
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total to pay</div>
          <div className="text-3xl font-semibold font-mono">{fmtMoney(String(total))}</div>
        </div>
      </div>

      <Card><CardContent className="grid grid-cols-1 gap-3 pt-6 md:grid-cols-4">
        <div>
          <Label className="text-xs text-muted-foreground">Payment account</Label>
          <AppSelect
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={form.cash_account_id}
            onChange={e => setForm(f => ({ ...f, cash_account_id: e.target.value }))}
            required
          >
            <option value="">Choose an account</option>
            {payFrom.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </AppSelect>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Payment date</Label>
          <DateInput value={form.payment_date} onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} required />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Method</Label>
          <AppSelect
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={form.payment_method}
            onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
          >
            {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </AppSelect>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Reference (optional)</Label>
          <Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="Check no., batch…" />
        </div>
      </CardContent></Card>

      {!loading && bills.length === 0 ? (
        <EmptyState title="Nothing to pay" hint="Every posted bill is paid in full." actionLabel="New bill" actionTo="/ap/bills/new" />
      ) : (
        <Card><CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <Input
              className="h-9 max-w-xs"
              placeholder="Filter by vendor or bill no."
              value={vendorFilter}
              onChange={e => setVendorFilter(e.target.value)}
            />
            <div className="text-sm text-muted-foreground">
              {selected.length} of {bills.length} selected{vendorCount > 0 && ` · ${vendorCount} vendor${vendorCount === 1 ? '' : 's'}`}
            </div>
          </div>
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b">
                <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 p-3 text-left">
                    <input
                      type="checkbox"
                      aria-label="Select all shown"
                      checked={shown.length > 0 && shown.every(b => payments[b.bill_id] !== undefined)}
                      onChange={e => toggleAllShown(e.target.checked)}
                    />
                  </th>
                  <th className="p-3 text-left">Vendor</th>
                  <th className="p-3 text-left">Bill no.</th>
                  <th className="p-3 text-left">Due date</th>
                  <th className="p-3 text-right">Open balance</th>
                  <th className="p-3 text-right">Payment</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!loading && shown.length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No bills match the filter.</td></tr>
                )}
                {shown.map(bill => {
                  const on = payments[bill.bill_id] !== undefined;
                  const over = on && (Number(payments[bill.bill_id]) || 0) > Number(bill.open_balance) + 0.005;
                  return (
                    <tr key={bill.bill_id} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="p-3">
                        <input type="checkbox" checked={on} onChange={() => toggle(bill)} aria-label={`Pay bill ${bill.bill_number}`} />
                      </td>
                      <td className="p-3"><Link className="text-primary hover:underline" to={`/ap/vendors/${bill.vendor_id}`}>{bill.vendor_name}</Link></td>
                      <td className="p-3 font-mono"><Link className="text-primary hover:underline" to={`/ap/bills/${bill.bill_id}`}>{bill.bill_number}</Link></td>
                      <td className="p-3 whitespace-nowrap">
                        {fmtShortDate(bill.due_date)}
                        {bill.due_date < today && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">Overdue</span>}
                      </td>
                      <td className="p-3 text-right font-mono">{fmtMoney(bill.open_balance)}</td>
                      <td className="p-3">
                        <MoneyInput
                          className={`ml-auto h-9 w-32 text-right font-mono ${over ? 'border-destructive' : ''}`}
                          value={payments[bill.bill_id] ?? ''}
                          onChange={e => setPayments(prev => ({ ...prev, [bill.bill_id]: e.target.value }))}
                          placeholder="0.00"
                          aria-label={`Payment for bill ${bill.bill_number}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )}

      {overpaid && <p className="text-sm text-destructive">The payment for bill {overpaid.bill_number} is more than is owed on it.</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex items-center gap-2 sticky -bottom-4 z-10 lg:-bottom-6 border-t bg-background py-3">
        <div className="flex-1" />
        <Button type="submit" disabled={busy || !ready}>
          {busy ? 'Paying…' : selected.length > 0 ? `Pay ${selected.length} bill${selected.length === 1 ? '' : 's'}` : 'Pay bills'}
        </Button>
      </div>
    </form>
  );
}
