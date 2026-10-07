import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CreditCard, FileDown, FileText, Trash2 } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailActivity, DetailField, DetailMetric, DetailPageHeader, baseDetailMenuActions } from '@/components/ui/detail-page';
import { fmtDateTime, fmtLongDate } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';
import { PostErrorNotice } from '@/components/SaveAndPost';
import { fmtQty } from '@/lib/labels';
import { cachedGet } from '@/lib/referenceDataCache';
import { downloadInvoicePdf } from '@/lib/invoicePdf';

type Invoice = {
  id: string;
  customer_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  status: string;
  memo: string | null;
  terms: string | null;
  subtotal: string;
  tax_total: string;
  total: string;
  posted_journal_entry_id: string | null;
  posted_at: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
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

type Customer = { id: string; name: string; company_name: string | null; email: string | null };


export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function reload() {
    if (!bizId || !id) return;
    const r = await api.get<InvoiceDetail>(`/businesses/${bizId}/invoices/${id}`);
    setData(r.data);
    try {
      const c = await api.get<Customer>(`/businesses/${bizId}/customers/${r.data.invoice.customer_id}`);
      setCustomer(c.data);
    } catch {
      setCustomer(null);
    }
  }
  useEffect(() => { void reload(); }, [bizId, id]);

  async function post() {
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/invoices/${id}/post`); await reload(); }
    catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  async function voidIt() {
    const reason = window.prompt('Reason for voiding?');
    if (!reason) return;
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/invoices/${id}/void`, { void_reason: reason }); await reload(); }
    catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  // The invoice as a document to send: company, customer, lines and balance due.
  async function savePdf() {
    if (!data || !bizId) return;
    setErr(null);
    try {
      const company = await cachedGet<{
        name: string;
        address: { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string } | null;
      }>(`/businesses/${bizId}`);
      const a = company.address;
      const cityLine = [[a?.city, a?.state].filter(Boolean).join(', '), a?.postal_code].filter(Boolean).join(' ');
      const invoice = data.invoice;
      downloadInvoicePdf({
        companyName: company.name,
        companyAddressLines: [a?.line1, a?.line2, cityLine || null, a?.country].filter((l): l is string => !!l),
        customerName: customer?.name ?? '',
        invoiceNumber: invoice.invoice_number,
        issueDate: fmtLongDate(invoice.issue_date),
        dueDate: fmtLongDate(invoice.due_date),
        terms: invoice.terms,
        status: invoice.status,
        lines: data.lines.map(l => ({ description: l.description, quantity: l.quantity, unitPrice: l.unit_price, amount: l.line_subtotal })),
        subtotal: invoice.subtotal,
        taxTotal: invoice.tax_total,
        total: invoice.total,
        paid: String(Number(invoice.total) - Number(data.amount_due)),
        balanceDue: data.amount_due,
        memo: invoice.memo,
      });
    } catch (e: unknown) { setErr(pickErr(e)); }
  }

  if (!data) return <div>Loading...</div>;
  const inv = data.invoice;
  const paid = Number(inv.total) - Number(data.amount_due);
  const canPost = inv.status === 'draft';
  const canReceive = (inv.status === 'posted' || inv.status === 'paid') && Number(data.amount_due) > 0;
  const canVoid = inv.status === 'posted' || inv.status === 'paid';

  return (
    <div className="space-y-6">
      <DetailPageHeader
        eyebrow="Invoice"
        title={inv.invoice_number}
        subtitle={customer ? <Link className="text-primary hover:underline" to={`/customers/${customer.id}`}>{customer.name}</Link> : 'Customer'}
        status={inv.status}
        totalLabel="Balance due"
        total={fmtMoney(data.amount_due)}
        actions={[
          ...(canPost ? [{ label: busy ? 'Posting...' : 'Post invoice', icon: <FileText className="h-4 w-4" />, onClick: post, disabled: busy }] : []),
          ...(canReceive ? [{ label: 'Receive payment', icon: <CreditCard className="h-4 w-4" />, to: `/payments/new?customer_id=${inv.customer_id}&invoice_id=${inv.id}` }] : []),
        ]}
        menuActions={[
          ...baseDetailMenuActions(),
          { label: 'Save as PDF', icon: <FileDown className="h-4 w-4" />, onSelect: savePdf },
          ...(canVoid ? [{ label: 'Void invoice', icon: <Trash2 className="h-4 w-4" />, onSelect: voidIt, destructive: true, disabled: busy }] : []),
        ]}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <DetailMetric label="Invoice total" value={fmtMoney(inv.total)} hint={`${data.lines.length} line${data.lines.length === 1 ? '' : 's'}`} />
        <DetailMetric label="Paid or credited" value={fmtMoney(paid)} hint="Applied to this invoice" />
        <DetailMetric label="Due date" value={fmtLongDate(inv.due_date)} hint={inv.terms ?? 'No terms set'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Invoice details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Customer" value={customer ? <Link className="text-primary hover:underline" to={`/customers/${customer.id}`}>{customer.name}</Link> : inv.customer_id} />
            <DetailField label="Customer email" value={customer?.email} />
            <DetailField label="Invoice date" value={fmtLongDate(inv.issue_date)} />
            <DetailField label="Due date" value={fmtLongDate(inv.due_date)} />
            <DetailField label="Terms" value={inv.terms} />
            <DetailField label="Memo" value={inv.memo} />
            <DetailField label="Subtotal" value={fmtMoney(inv.subtotal)} />
            <DetailField label="Sales tax" value={fmtMoney(inv.tax_total)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <CardContent>
            <DetailActivity
              items={[
                { label: 'Created', value: fmtDateTime(inv.created_at) },
                { label: 'Last updated', value: fmtDateTime(inv.updated_at) },
                { label: 'Posted', value: inv.posted_at ? fmtDateTime(inv.posted_at) : null },
                { label: 'Voided', value: inv.voided_at ? fmtDateTime(inv.voided_at) : null },
                {
                  label: 'Journal entry',
                  value: inv.posted_journal_entry_id
                    ? <Link className="font-mono text-primary hover:underline" to={`/journal/${inv.posted_journal_entry_id}`}>View journal entry</Link>
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
                <th className="p-3 text-right">Rate</th>
                <th className="p-3 text-right">Subtotal</th>
                <th className="p-3 text-right">Tax</th>
                <th className="p-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map(l => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="p-3">{l.line_number}</td>
                  <td className="p-3">{l.description}</td>
                  <td className="p-3 text-right">{fmtQty(l.quantity)}</td>
                  <td className="p-3 text-right">{fmtMoney(l.unit_price)}</td>
                  <td className="p-3 text-right">{fmtMoney(l.line_subtotal)}</td>
                  <td className="p-3 text-right">{fmtMoney(l.tax_amount)}</td>
                  <td className="p-3 text-right font-mono">{fmtMoney(l.line_total)}</td>
                </tr>
              ))}
              <tr className="border-t bg-muted/20 font-semibold">
                <td className="p-3 text-right" colSpan={6}>Invoice total</td>
                <td className="p-3 text-right font-mono">{fmtMoney(inv.total)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <PostErrorNotice />
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button variant="outline" onClick={() => nav('/invoices')}>Back to invoices</Button>
    </div>
  );
}
