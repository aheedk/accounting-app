import { useEffect, useState } from 'react';
import { hideUnless, useCan } from '@/lib/roleAccess';
import { useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useAuth } from '@/auth/useAuth';
import { billPaymentCheck, type CheckVendor } from '@/lib/billPaymentCheck';
import { previewCheck, type CheckLayout } from '@/lib/download';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MoneyInput } from '@/components/ui/money-input';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { AppSelect } from '../../components/ui/select';
import { PostErrorNotice } from '@/components/SaveAndPost';
import { humanizeCode } from '@/lib/labels';

type BillPayment = {
  id: string;
  vendor_id: string;
  cash_account_id: string;
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
  bill_id: string;
  bill_number: string;
  applied_amount: string;
  applied_at: string;
};

type BillPaymentDetail = {
  bill_payment: BillPayment;
  applications: Application[];
};

type OpenBill = { id: string; bill_number: string; total: string };

export default function BillPaymentDetailPage() {
  // What this login may do here; anything it may not is left off the page.
  const can = useCan();
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const [data, setData] = useState<BillPaymentDetail | null>(null);
  const [openBills, setOpenBills] = useState<OpenBill[]>([]);
  const [applyForm, setApplyForm] = useState({ bill_id: '', applied_amount: '0.00' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!bizId || !id) return;
    const r = await api.get(`/businesses/${bizId}/bill-payments/${id}`);
    setData(r.data);
    const bills = await api.get(`/businesses/${bizId}/bills`, { params: { vendor_id: r.data.bill_payment.vendor_id, status: 'posted' } });
    setOpenBills(bills.data.bills);
  }
  useEffect(() => { reload(); }, [bizId, id]);

  async function post() {
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/bill-payments/${id}/post`); await reload(); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }
  async function voidIt() {
    const reason = window.prompt('Reason?'); if (!reason) return;
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/bill-payments/${id}/void`, { void_reason: reason }); await reload(); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }
  async function apply(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/bill-payments/${id}/applications`, { bill_id: applyForm.bill_id, applied_amount: parseMoneyInput(applyForm.applied_amount) });
      setApplyForm({ bill_id: '', applied_amount: '0.00' });
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }
  async function unapply(appId: string) {
    setBusy(true); setErr(null);
    try { await api.delete(`/businesses/${bizId}/bill-payments/${id}/applications/${appId}`); await reload(); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }

  // Prints this payment's check again: the vendor and the bank account are
  // only needed for the paper, so they are fetched when it is asked for.
  async function printCheck(layout: CheckLayout) {
    if (!bizId || !data) return;
    const payment = data.bill_payment;
    setErr(null);
    try {
      const [vendor, banks] = await Promise.all([
        api.get<CheckVendor>(`/businesses/${bizId}/vendors/${payment.vendor_id}`).then(r => r.data),
        api.get<{ bank_accounts: Array<{ cash_account_id: string; name: string; account_last_four: string | null }> }>(`/businesses/${bizId}/bank-accounts`)
          .then(r => r.data.bank_accounts ?? []).catch(() => []),
      ]);
      const bank = banks.find(b => b.cash_account_id === payment.cash_account_id);
      previewCheck(billPaymentCheck({
        checkNumber: payment.reference,
        paymentDate: String(payment.payment_date),
        vendor,
        amount: payment.amount,
        bills: data.applications.map(a => ({ bill_number: a.bill_number, amount: a.applied_amount })),
        bankAccountName: bank?.name ?? '',
        bankAccountLastFour: bank?.account_last_four ?? null,
        memo: payment.memo,
        businessName: businesses.find(b => b.id === bizId)?.name ?? '',
      }), null, layout);
    } catch {
      setErr('The check could not be prepared for printing');
    }
  }

  if (!data) return <div>Loading…</div>;
  const p = data.bill_payment;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bill Payment {p.payment_date}</h1>
        <div className="flex gap-2">
          {p.status === 'posted' && p.payment_method === 'check' && (
            <>
              <Button variant="outline" onClick={() => void printCheck('stock')}>
                <Printer className="mr-1.5 h-4 w-4" /> Print on check stock
              </Button>
              <Button variant="outline" onClick={() => void printCheck('plain')}>Print on plain paper</Button>
            </>
          )}
          {p.status === 'draft' && <Button disabled={busy} {...hideUnless(can.accountant)} onClick={post}>Post</Button>}
          {p.status === 'posted' && <Button variant="destructive" disabled={busy} {...hideUnless(can.accountant)} onClick={voidIt}>Void</Button>}
        </div>
      </div>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>Status: {humanizeCode(p.status)}</div><div>Method: {humanizeCode(p.payment_method)}</div>
          <div>Amount: {fmtMoney(p.amount)}</div><div>Unapplied: {fmtMoney(p.unapplied_amount)}</div>
          <div>{p.payment_method === 'check' ? 'Check no.' : 'Reference'}: {p.reference ?? '—'}</div><div>Memo: {p.memo ?? '—'}</div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Applications</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Bill</th><th className="text-right p-3">Applied</th><th className="text-left p-3">When</th><th></th></tr></thead>
            <tbody>{data.applications.map((a: Application) => (
              <tr key={a.id} className="border-b last:border-b-0">
                <td className="p-3 font-mono">{a.bill_number}</td>
                <td className="p-3 text-right">{fmtMoney(a.applied_amount)}</td>
                <td className="p-3">{new Date(a.applied_at).toLocaleString()}</td>
                <td className="p-3"><Button size="sm" variant="ghost" {...hideUnless(can.accountant)} onClick={() => unapply(a.id)} disabled={busy}>Unapply</Button></td>
              </tr>
            ))}</tbody>
          </table>
          {parseFloat(p.unapplied_amount) > 0 && (
            <form className="grid grid-cols-12 gap-2 items-end" onSubmit={apply}>
              <div className="col-span-7"><label className="text-sm">Bill</label>
                <AppSelect className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={applyForm.bill_id} onChange={e => setApplyForm(f => ({ ...f, bill_id: e.target.value }))} required>
                  <option value="">Select open bill…</option>{openBills.map(b => <option key={b.id} value={b.id}>{b.bill_number} — {fmtMoney(b.total)}</option>)}
                </AppSelect>
              </div>
              <div className="col-span-3"><label className="text-sm">Apply amount</label><MoneyInput value={applyForm.applied_amount} onChange={e => setApplyForm(f => ({ ...f, applied_amount: e.target.value }))} /></div>
              <div className="col-span-2"><Button type="submit" disabled={busy}>Apply</Button></div>
            </form>
          )}
        </CardContent>
      </Card>
      <PostErrorNotice />
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
