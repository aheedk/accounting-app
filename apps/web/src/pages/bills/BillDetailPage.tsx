import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type Bill = {
  id: string;
  bill_number: string;
  vendor_id: string;
  bill_date: string;
  due_date: string;
  status: string;
  memo: string | null;
  subtotal: string;
  total: string;
};

type BillLine = {
  id: string;
  line_number: number;
  description: string;
  quantity: string;
  unit_price: string;
  line_subtotal: string;
};

type BillDetail = {
  bill: Bill;
  lines: BillLine[];
  amount_due: string;
};

type Vendor = { id: string; name: string };

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<BillDetail | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function reload() {
    if (!bizId || !id) return;
    const r = await api.get(`/businesses/${bizId}/bills/${id}`);
    setData(r.data);
    if (r.data?.bill?.vendor_id) {
      const v = await api.get(`/businesses/${bizId}/vendors/${r.data.bill.vendor_id}`);
      setVendor(v.data);
    }
  }
  useEffect(() => { reload(); }, [bizId, id]);

  async function post() {
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/bills/${id}/post`); await reload(); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }
  async function voidIt() {
    const reason = window.prompt('Reason for voiding?'); if (!reason) return;
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/bills/${id}/void`, { void_reason: reason }); await reload(); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }

  if (!data) return <div>Loading…</div>;
  const bill = data.bill;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bill {bill.bill_number}</h1>
        <div className="flex gap-2">
          {bill.status === 'draft' && <Button disabled={busy} onClick={post}>Post bill</Button>}
          {(bill.status === 'posted' || bill.status === 'paid') && <Button variant="destructive" disabled={busy} onClick={voidIt}>Void</Button>}
        </div>
      </div>
      <Card><CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>Status: {bill.status}</div>
          <div>Vendor: {vendor?.name ?? '—'}</div>
          <div>Bill date: {bill.bill_date}</div>
          <div>Due: {bill.due_date}</div>
          <div>Memo: {bill.memo ?? '—'}</div>
          <div>Subtotal: {fmtMoney(bill.subtotal)}</div>
          <div className="font-semibold">Total: {fmtMoney(bill.total)}</div>
          <div>Amount due: {fmtMoney(data.amount_due)}</div>
        </CardContent>
      </Card>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">#</th><th className="text-left p-3">Description</th><th className="text-right p-3">Qty</th><th className="text-right p-3">Unit</th><th className="text-right p-3">Subtotal</th></tr></thead>
          <tbody>{data.lines.map((l: BillLine) => (
            <tr key={l.id} className="border-b last:border-b-0">
              <td className="p-3">{l.line_number}</td>
              <td className="p-3">{l.description}</td>
              <td className="p-3 text-right">{l.quantity}</td>
              <td className="p-3 text-right">{fmtMoney(l.unit_price)}</td>
              <td className="p-3 text-right">{fmtMoney(l.line_subtotal)}</td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button variant="outline" onClick={() => nav('/ap/bills')}>Back to list</Button>
    </div>
  );
}
