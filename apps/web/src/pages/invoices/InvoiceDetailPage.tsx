import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type Invoice = {
  id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  status: string;
  memo: string | null;
  terms: string | null;
  subtotal: string;
  tax_total: string;
  total: string;
};

type InvoiceLine = {
  id: string;
  line_number: number;
  description: string;
  quantity: string;
  unit_price: string;
  line_subtotal: string;
  tax_amount: string;
  line_total: string;
};

type InvoiceDetail = {
  invoice: Invoice;
  lines: InvoiceLine[];
  amount_due: string;
};

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function reload() {
    if (!bizId || !id) return;
    const r = await api.get(`/businesses/${bizId}/invoices/${id}`);
    setData(r.data);
  }
  useEffect(() => { reload(); }, [bizId, id]);

  async function post() {
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/invoices/${id}/post`); await reload(); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }
  async function voidIt() {
    const reason = window.prompt('Reason for voiding?'); if (!reason) return;
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/invoices/${id}/void`, { void_reason: reason }); await reload(); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }

  if (!data) return <div>Loading…</div>;
  const inv = data.invoice;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoice {inv.invoice_number}</h1>
        <div className="flex gap-2">
          {inv.status === 'draft' && <Button disabled={busy} onClick={post}>Post invoice</Button>}
          {(inv.status === 'posted' || inv.status === 'paid') && <Button variant="destructive" disabled={busy} onClick={voidIt}>Void</Button>}
        </div>
      </div>
      <Card><CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>Status: {inv.status}</div>
          <div>Invoice date: {inv.issue_date}</div>
          <div>Due date: {inv.due_date}</div>
          <div>Terms: {inv.terms ?? '—'}</div>
          <div>Note to customer: {inv.memo ?? '—'}</div>
          <div>Subtotal: {fmtMoney(inv.subtotal)}</div>
          <div>Sales tax: {fmtMoney(inv.tax_total)}</div>
          <div className="font-semibold">Invoice total: {fmtMoney(inv.total)}</div>
          <div>Balance due: {fmtMoney(data.amount_due)}</div>
        </CardContent>
      </Card>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">#</th><th className="text-left p-3">Description</th><th className="text-right p-3">Qty</th><th className="text-right p-3">Rate</th><th className="text-right p-3">Subtotal</th><th className="text-right p-3">Tax</th><th className="text-right p-3">Amount</th></tr></thead>
          <tbody>{data.lines.map((l: InvoiceLine) => (
            <tr key={l.id} className="border-b last:border-b-0">
              <td className="p-3">{l.line_number}</td>
              <td className="p-3">{l.description}</td>
              <td className="p-3 text-right">{l.quantity}</td>
              <td className="p-3 text-right">{fmtMoney(l.unit_price)}</td>
              <td className="p-3 text-right">{fmtMoney(l.line_subtotal)}</td>
              <td className="p-3 text-right">{fmtMoney(l.tax_amount)}</td>
              <td className="p-3 text-right">{fmtMoney(l.line_total)}</td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button variant="outline" onClick={() => nav('/invoices')}>Back to list</Button>
    </div>
  );
}
