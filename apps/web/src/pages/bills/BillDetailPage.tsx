import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileText, ReceiptText, Trash2 } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { roleAtLeast, useCanOpen, useEffectiveRole } from '@/lib/roleAccess';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailActivity, DetailField, DetailMetric, DetailPageHeader, baseDetailMenuActions } from '@/components/ui/detail-page';
import { fmtDateTime, fmtLongDate } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';
import { PostErrorNotice } from '@/components/SaveAndPost';
import { fmtQty } from '@/lib/labels';

type Bill = {
  id: string;
  bill_number: string;
  vendor_id: string;
  bill_date: string;
  due_date: string;
  status: string;
  memo: string | null;
  terms: string | null;
  subtotal: string;
  total: string;
  posted_journal_entry_id: string | null;
  posted_at: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
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

type Vendor = { id: string; name: string; company_name?: string | null; email?: string | null };


export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  // What the API allows: staff can pay a bill, an accountant posts and voids, a client or view-only login reads.
  const role = useEffectiveRole();
  const isStaff = roleAtLeast(role, 'staff');
  // Links are offered where the page behind them can be opened (not for a client).
  const canOpen = useCanOpen();
  const linksOut = canOpen('/ap/vendors');
  const isAccountant = roleAtLeast(role, 'accountant');
  const [data, setData] = useState<BillDetail | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function reload() {
    if (!bizId || !id) return;
    const r = await api.get<BillDetail>(`/businesses/${bizId}/bills/${id}`);
    setData(r.data);
    if (r.data?.bill?.vendor_id) {
      try {
        const v = await api.get<Vendor>(`/businesses/${bizId}/vendors/${r.data.bill.vendor_id}`);
        setVendor(v.data);
      } catch {
        setVendor(null);
      }
    }
  }
  useEffect(() => { void reload(); }, [bizId, id]);

  async function post() {
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/bills/${id}/post`); await reload(); }
    catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  async function voidIt() {
    const reason = window.prompt('Reason for voiding?');
    if (!reason) return;
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/bills/${id}/void`, { void_reason: reason }); await reload(); }
    catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  if (!data) return <div>Loading...</div>;
  const bill = data.bill;
  const paid = Number(bill.total) - Number(data.amount_due);
  const canPost = isAccountant && bill.status === 'draft';
  const canPay = isStaff && bill.status === 'posted' && Number(data.amount_due) > 0;
  const canVoid = isAccountant && (bill.status === 'posted' || bill.status === 'paid');

  return (
    <div className="space-y-6">
      <DetailPageHeader
        eyebrow="Bill"
        title={bill.bill_number}
        subtitle={!vendor ? 'Vendor' : linksOut ? <Link className="text-primary hover:underline" to={`/ap/vendors/${vendor.id}`}>{vendor.name}</Link> : vendor.name}
        status={bill.status}
        totalLabel="Amount due"
        total={fmtMoney(data.amount_due)}
        actions={[
          ...(canPost ? [{ label: busy ? 'Posting...' : 'Post bill', icon: <FileText className="h-4 w-4" />, onClick: post, disabled: busy }] : []),
          ...(canPay ? [{ label: 'Pay bill', icon: <ReceiptText className="h-4 w-4" />, to: `/ap/bill-payments/new?vendor_id=${bill.vendor_id}&bill_id=${bill.id}` }] : []),
        ]}
        menuActions={[
          ...baseDetailMenuActions(),
          ...(canVoid ? [{ label: 'Void bill', icon: <Trash2 className="h-4 w-4" />, onSelect: voidIt, destructive: true, disabled: busy }] : []),
        ]}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <DetailMetric label="Bill total" value={fmtMoney(bill.total)} hint={`${data.lines.length} line${data.lines.length === 1 ? '' : 's'}`} />
        <DetailMetric label="Paid or credited" value={fmtMoney(paid)} hint="Applied to this bill" />
        <DetailMetric label="Due date" value={fmtLongDate(bill.due_date)} hint={bill.terms ?? 'No terms set'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Bill details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Vendor" value={!vendor ? null : linksOut ? <Link className="text-primary hover:underline" to={`/ap/vendors/${vendor.id}`}>{vendor.name}</Link> : vendor.name} />
            <DetailField label="Vendor email" value={vendor?.email} />
            <DetailField label="Bill date" value={fmtLongDate(bill.bill_date)} />
            <DetailField label="Due date" value={fmtLongDate(bill.due_date)} />
            <DetailField label="Terms" value={bill.terms} />
            <DetailField label="Memo" value={bill.memo} />
            <DetailField label="Subtotal" value={fmtMoney(bill.subtotal)} />
            <DetailField label="Total" value={fmtMoney(bill.total)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <CardContent>
            <DetailActivity
              items={[
                { label: 'Created', value: fmtDateTime(bill.created_at) },
                { label: 'Last updated', value: fmtDateTime(bill.updated_at) },
                { label: 'Posted', value: bill.posted_at ? fmtDateTime(bill.posted_at) : null },
                { label: 'Voided', value: bill.voided_at ? fmtDateTime(bill.voided_at) : null },
                {
                  label: 'Journal entry',
                  // The journal is not part of a client login.
                  value: bill.posted_journal_entry_id && canOpen('/journal')
                    ? <Link className="font-mono text-primary hover:underline" to={`/journal/${bill.posted_journal_entry_id}`}>View journal entry</Link>
                    : null,
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Lines</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="p-3 text-left">#</th>
                <th className="p-3 text-left">Description</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3 text-right">Unit cost</th>
                <th className="p-3 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map(l => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="p-3">{l.line_number}</td>
                  <td className="p-3">{l.description}</td>
                  <td className="p-3 text-right">{fmtQty(l.quantity)}</td>
                  <td className="p-3 text-right">{fmtMoney(l.unit_price)}</td>
                  <td className="p-3 text-right font-mono">{fmtMoney(l.line_subtotal)}</td>
                </tr>
              ))}
              <tr className="border-t bg-muted/20 font-semibold">
                <td className="p-3 text-right" colSpan={4}>Bill total</td>
                <td className="p-3 text-right font-mono">{fmtMoney(bill.total)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <PostErrorNotice />
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button variant="outline" onClick={() => nav('/ap/bills')}>Back to bills</Button>
    </div>
  );
}
