import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileText, Trash2 } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DetailActivity, DetailField, DetailMetric, DetailPageHeader, baseDetailMenuActions } from '@/components/ui/detail-page';
import { fmtDateTime, fmtLongDate } from '@/lib/dates';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';

type Payment = {
  id: string;
  customer_id: string;
  payment_date: string;
  payment_method: string;
  status: string;
  amount: string;
  unapplied_amount: string;
  cash_account_id: string;
  posted_journal_entry_id: string | null;
  reference: string | null;
  memo: string | null;
  posted_at: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

type Application = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  applied_amount: string;
  applied_at: string;
};

type PaymentDetail = {
  payment: Payment;
  applications: Application[];
};

type OpenInvoice = { id: string; invoice_number: string; total: string };
type Customer = { id: string; name: string; email?: string | null };
type Account = { id: string; code: string; name: string };


export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [data, setData] = useState<PaymentDetail | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [applyForm, setApplyForm] = useState({ invoice_id: '', applied_amount: '0.00' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!bizId || !id) return;
    const r = await api.get<PaymentDetail>(`/businesses/${bizId}/payments/${id}`);
    setData(r.data);
    try {
      const c = await api.get<Customer>(`/businesses/${bizId}/customers/${r.data.payment.customer_id}`);
      setCustomer(c.data);
    } catch {
      setCustomer(null);
    }
    const inv = await api.get(`/businesses/${bizId}/invoices`, { params: { customer_id: r.data.payment.customer_id, status: 'posted' } });
    setOpenInvoices(inv.data.invoices);
  }

  useEffect(() => { void reload(); }, [bizId, id]);
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts)).catch(() => setAccounts([]));
  }, [bizId]);

  async function post() {
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/payments/${id}/post`); await reload(); }
    catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  async function voidIt() {
    const reason = window.prompt('Reason?');
    if (!reason) return;
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/payments/${id}/void`, { void_reason: reason }); await reload(); }
    catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  async function apply(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/payments/${id}/applications`, { invoice_id: applyForm.invoice_id, applied_amount: parseMoneyInput(applyForm.applied_amount) });
      setApplyForm({ invoice_id: '', applied_amount: '0.00' });
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
    finally { setBusy(false); }
  }

  async function unapply(appId: string) {
    setBusy(true); setErr(null);
    try { await api.delete(`/businesses/${bizId}/payments/${id}/applications/${appId}`); await reload(); }
    catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  const accountMap = useMemo(() => new Map(accounts.map(a => [a.id, `${a.code} - ${a.name}`])), [accounts]);

  if (!data) return <div>Loading...</div>;
  const p = data.payment;
  const applied = Number(p.amount) - Number(p.unapplied_amount);
  const canPost = p.status === 'draft';
  const canVoid = p.status === 'posted';

  return (
    <div className="space-y-6">
      <DetailPageHeader
        eyebrow="Payment"
        title={p.reference ? `Payment ${p.reference}` : fmtLongDate(p.payment_date)}
        subtitle={customer ? <Link className="text-primary hover:underline" to={`/customers/${customer.id}`}>{customer.name}</Link> : 'Customer payment'}
        status={p.status}
        totalLabel="Payment amount"
        total={fmtMoney(p.amount)}
        actions={canPost ? [{ label: busy ? 'Posting...' : 'Post payment', icon: <FileText className="h-4 w-4" />, onClick: post, disabled: busy }] : []}
        menuActions={[
          ...baseDetailMenuActions(),
          ...(canVoid ? [{ label: 'Void payment', icon: <Trash2 className="h-4 w-4" />, onSelect: voidIt, destructive: true, disabled: busy }] : []),
        ]}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <DetailMetric label="Applied" value={fmtMoney(applied)} hint={`${data.applications.length} invoice application${data.applications.length === 1 ? '' : 's'}`} />
        <DetailMetric label="Unapplied" value={fmtMoney(p.unapplied_amount)} hint="Available to apply" />
        <DetailMetric label="Payment date" value={fmtLongDate(p.payment_date)} hint={p.payment_method.replace(/_/g, ' ')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Payment details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Customer" value={customer ? <Link className="text-primary hover:underline" to={`/customers/${customer.id}`}>{customer.name}</Link> : p.customer_id} />
            <DetailField label="Customer email" value={customer?.email} />
            <DetailField label="Method" value={p.payment_method.replace(/_/g, ' ')} />
            <DetailField label="Deposit account" value={accountMap.get(p.cash_account_id) ?? p.cash_account_id} />
            <DetailField label="Reference" value={p.reference} />
            <DetailField label="Memo" value={p.memo} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <CardContent>
            <DetailActivity
              items={[
                { label: 'Created', value: fmtDateTime(p.created_at) },
                { label: 'Last updated', value: fmtDateTime(p.updated_at) },
                { label: 'Posted', value: p.posted_at ? fmtDateTime(p.posted_at) : null },
                { label: 'Voided', value: p.voided_at ? fmtDateTime(p.voided_at) : null },
                {
                  label: 'Journal entry',
                  value: p.posted_journal_entry_id
                    ? <Link className="font-mono text-primary hover:underline" to={`/journal/${p.posted_journal_entry_id}`}>JE {p.posted_journal_entry_id.slice(0, 8)}</Link>
                    : null,
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Invoice applications</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="p-3 text-left">Invoice</th>
                  <th className="p-3 text-right">Applied</th>
                  <th className="p-3 text-left">Applied at</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.applications.length === 0 ? (
                  <tr><td className="p-6 text-muted-foreground" colSpan={4}>No invoices are applied to this payment yet.</td></tr>
                ) : data.applications.map(a => (
                  <tr key={a.id} className="border-b last:border-b-0">
                    <td className="p-3 font-mono">
                      <Link className="text-primary hover:underline" to={`/invoices/${a.invoice_id}`}>{a.invoice_number}</Link>
                    </td>
                    <td className="p-3 text-right font-mono">{fmtMoney(a.applied_amount)}</td>
                    <td className="p-3">{fmtDateTime(a.applied_at)}</td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => unapply(a.id)} disabled={busy}>Unapply</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {parseFloat(p.unapplied_amount) > 0 && (
            <form className="grid gap-3 md:grid-cols-12 md:items-end" onSubmit={apply}>
              <div className="md:col-span-7">
                <label className="text-sm font-medium">Invoice</label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={applyForm.invoice_id} onChange={e => setApplyForm(f => ({ ...f, invoice_id: e.target.value }))} required>
                  <option value="">Select open invoice...</option>
                  {openInvoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} - {fmtMoney(i.total)}</option>)}
                </select>
              </div>
              <div className="md:col-span-3">
                <label className="text-sm font-medium">Apply amount</label>
                <Input type="number" step="0.01" value={applyForm.applied_amount} onChange={e => setApplyForm(f => ({ ...f, applied_amount: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={busy}>Apply</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button variant="outline" onClick={() => nav('/payments')}>Back to payments</Button>
    </div>
  );
}
