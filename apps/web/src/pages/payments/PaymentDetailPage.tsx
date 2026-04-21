import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { fmtMoney, parseMoneyInput } from '@/lib/money';

type Payment = {
  id: string;
  customer_id: string;
  payment_date: string;
  payment_method: string;
  status: string;
  amount: string;
  unapplied_amount: string;
  reference: string | null;
  memo: string | null;
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

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<PaymentDetail | null>(null);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [applyForm, setApplyForm] = useState({ invoice_id: '', applied_amount: '0.00' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!bizId || !id) return;
    const r = await api.get(`/businesses/${bizId}/payments/${id}`);
    setData(r.data);
    const inv = await api.get(`/businesses/${bizId}/invoices`, { params: { customer_id: r.data.payment.customer_id, status: 'posted' } });
    setOpenInvoices(inv.data.invoices);
  }
  useEffect(() => { reload(); }, [bizId, id]);

  async function post() {
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/payments/${id}/post`); await reload(); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }
  async function voidIt() {
    const reason = window.prompt('Reason?'); if (!reason) return;
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/payments/${id}/void`, { void_reason: reason }); await reload(); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }
  async function apply(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/payments/${id}/applications`, { invoice_id: applyForm.invoice_id, applied_amount: parseMoneyInput(applyForm.applied_amount) });
      setApplyForm({ invoice_id: '', applied_amount: '0.00' });
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }
  async function unapply(appId: string) {
    setBusy(true); setErr(null);
    try { await api.delete(`/businesses/${bizId}/payments/${id}/applications/${appId}`); await reload(); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }

  if (!data) return <div>Loading…</div>;
  const p = data.payment;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Payment {p.payment_date}</h1>
        <div className="flex gap-2">
          {p.status === 'draft' && <Button disabled={busy} onClick={post}>Post</Button>}
          {p.status === 'posted' && <Button variant="destructive" disabled={busy} onClick={voidIt}>Void</Button>}
        </div>
      </div>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>Status: {p.status}</div><div>Method: {p.payment_method}</div>
          <div>Amount: {fmtMoney(p.amount)}</div><div>Unapplied: {fmtMoney(p.unapplied_amount)}</div>
          <div>Reference: {p.reference ?? '—'}</div><div>Memo: {p.memo ?? '—'}</div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Applications</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Invoice</th><th className="text-right p-3">Applied</th><th className="text-left p-3">When</th><th></th></tr></thead>
            <tbody>{data.applications.map((a: Application) => (
              <tr key={a.id} className="border-b last:border-b-0">
                <td className="p-3 font-mono">{a.invoice_number}</td>
                <td className="p-3 text-right">{fmtMoney(a.applied_amount)}</td>
                <td className="p-3">{new Date(a.applied_at).toLocaleString()}</td>
                <td className="p-3"><Button size="sm" variant="ghost" onClick={() => unapply(a.id)} disabled={busy}>Unapply</Button></td>
              </tr>
            ))}</tbody>
          </table>
          {parseFloat(p.unapplied_amount) > 0 && (
            <form className="grid grid-cols-12 gap-2 items-end" onSubmit={apply}>
              <div className="col-span-7"><label className="text-sm">Invoice</label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={applyForm.invoice_id} onChange={e => setApplyForm(f => ({ ...f, invoice_id: e.target.value }))} required>
                  <option value="">Select open invoice…</option>{openInvoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} — {fmtMoney(i.total)}</option>)}
                </select>
              </div>
              <div className="col-span-3"><label className="text-sm">Apply amount</label><Input type="number" step="0.01" value={applyForm.applied_amount} onChange={e => setApplyForm(f => ({ ...f, applied_amount: e.target.value }))} /></div>
              <div className="col-span-2"><Button type="submit" disabled={busy}>Apply</Button></div>
            </form>
          )}
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
