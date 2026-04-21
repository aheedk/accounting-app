import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney, parseMoneyInput } from '@/lib/money';

type CreditMemo = {
  id: string;
  customer_id: string;
  memo_date: string;
  status: string;
  amount: string;
  remaining_amount: string;
  memo: string | null;
};

type OpenInvoice = { id: string; invoice_number: string; total: string };

export default function CreditMemoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<CreditMemo | null>(null);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [applyForm, setApplyForm] = useState({ invoice_id: '', applied_amount: '0.00' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!bizId || !id) return;
    const r = await api.get(`/businesses/${bizId}/credit-memos`);
    const cm = r.data.credit_memos.find((c: CreditMemo) => c.id === id);
    setData(cm);
    if (cm) {
      const inv = await api.get(`/businesses/${bizId}/invoices`, { params: { customer_id: cm.customer_id, status: 'posted' } });
      setOpenInvoices(inv.data.invoices);
    }
  }
  useEffect(() => { reload(); }, [bizId, id]);

  async function post() {
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/credit-memos/${id}/post`); await reload(); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }
  async function voidIt() {
    const reason = window.prompt('Reason?'); if (!reason) return;
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/credit-memos/${id}/void`, { void_reason: reason }); await reload(); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }
  async function apply(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/credit-memos/${id}/apply`, { invoice_id: applyForm.invoice_id, applied_amount: parseMoneyInput(applyForm.applied_amount) });
      setApplyForm({ invoice_id: '', applied_amount: '0.00' });
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }

  if (!data) return <div>Loading…</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Credit Memo</h1>
        <div className="flex gap-2">
          {data.status === 'draft' && <Button disabled={busy} onClick={post}>Post</Button>}
          {(data.status === 'posted' || data.status === 'applied') && <Button variant="destructive" disabled={busy} onClick={voidIt}>Void</Button>}
        </div>
      </div>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>Status: {data.status}</div>
          <div>Date: {data.memo_date}</div>
          <div>Amount: {fmtMoney(data.amount)}</div>
          <div>Remaining: {fmtMoney(data.remaining_amount)}</div>
          <div className="col-span-2">Memo: {data.memo ?? '—'}</div>
        </CardContent>
      </Card>
      {data.status === 'posted' && parseFloat(data.remaining_amount) > 0 && (
        <Card><CardHeader><CardTitle>Apply to invoice</CardTitle></CardHeader>
          <CardContent>
            <form className="grid grid-cols-12 gap-2 items-end" onSubmit={apply}>
              <div className="col-span-7"><label className="text-sm">Invoice</label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={applyForm.invoice_id} onChange={e => setApplyForm(f => ({ ...f, invoice_id: e.target.value }))} required>
                  <option value="">Select…</option>{openInvoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} — {fmtMoney(i.total)}</option>)}
                </select>
              </div>
              <div className="col-span-3"><label className="text-sm">Apply amount</label><Input type="number" step="0.01" value={applyForm.applied_amount} onChange={e => setApplyForm(f => ({ ...f, applied_amount: e.target.value }))} /></div>
              <div className="col-span-2"><Button type="submit" disabled={busy}>Apply</Button></div>
            </form>
          </CardContent>
        </Card>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
