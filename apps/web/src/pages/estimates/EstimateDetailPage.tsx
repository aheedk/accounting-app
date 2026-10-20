import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, FileDown, FileText, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailActivity, DetailField, DetailMetric, DetailPageHeader, baseDetailMenuActions, type DetailHeaderAction } from '@/components/ui/detail-page';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { fmtDateTime, fmtLongDate, todayLocal } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { fmtQty } from '@/lib/labels';
import { pickErr } from '@/lib/apiErrors';
import { cachedGet } from '@/lib/referenceDataCache';
import { downloadEstimatePdf } from '@/lib/invoicePdf';
import { useCan, useCanOpen } from '@/lib/roleAccess';
import { ESTIMATE_STATUS_LABELS, estimateCanInvoice, estimateShownStatus, type EstimateDetail } from '@/lib/estimates';

// One estimate: accept or reject it, make it into an invoice, print it.
// Spec: docs/specs/2026-10-20-estimates-design.md

export default function EstimateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const can = useCan();
  const canOpen = useCanOpen();
  const [data, setData] = useState<EstimateDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Marking it accepted asks who accepted it and when, as QuickBooks does.
  const [accepting, setAccepting] = useState<{ by: string; date: string } | null>(null);

  const load = useCallback(async () => {
    if (!bizId || !id) return;
    setLoadErr(null);
    try {
      const r = await api.get<EstimateDetail>(`/businesses/${bizId}/estimates/${id}`);
      setData(r.data);
    } catch (e: unknown) {
      setLoadErr(pickErr(e));
    }
  }, [bizId, id]);
  useEffect(() => { void load(); }, [load]);

  async function act(run: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await run(); } catch (e: unknown) { setErr(pickErr(e)); } finally { setBusy(false); }
  }

  const setStatus = (status: 'pending' | 'accepted' | 'rejected', extra: { accepted_by?: string | null; accepted_date?: string } = {}) =>
    act(async () => {
      await api.post(`/businesses/${bizId}/estimates/${id}/status`, { status, ...extra });
      setAccepting(null);
      await load();
    });

  // The invoice is a draft; posting it is an accountant's step on the invoice's page.
  const makeInvoice = () => act(async () => {
    const r = await api.post<{ invoice: { id: string } }>(`/businesses/${bizId}/estimates/${id}/convert`, { issue_date: todayLocal() });
    nav(`/invoices/${r.data.invoice.id}`);
  });

  const remove = () => {
    if (!data || !window.confirm(`Delete estimate ${data.estimate.estimate_number}? This cannot be undone.`)) return;
    void act(async () => {
      await api.delete(`/businesses/${bizId}/estimates/${id}`);
      nav('/estimates');
    });
  };

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
      const e = data.estimate;
      downloadEstimatePdf({
        companyName: company.name,
        companyAddressLines: [a?.line1, a?.line2, cityLine || null, a?.country].filter((l): l is string => !!l),
        customerName: e.customer_name,
        estimateNumber: e.estimate_number,
        estimateDate: fmtLongDate(e.estimate_date),
        expirationDate: e.expiration_date ? fmtLongDate(e.expiration_date) : null,
        lines: data.lines.map(l => ({ description: l.description, quantity: l.quantity, unitPrice: l.unit_price, amount: l.line_subtotal })),
        subtotal: e.subtotal,
        taxTotal: e.tax_total,
        total: e.total,
        memo: e.memo,
      });
    } catch (e: unknown) { setErr(pickErr(e)); }
  }

  if (loadErr) return <ErrorState message={loadErr} onRetry={() => void load()} />;
  if (!data) return <LoadingIndicator />;
  const e = data.estimate;
  const shown = estimateShownStatus(e, todayLocal());
  const open = e.status !== 'closed';
  const customerLink = canOpen('/customers')
    ? <Link className="text-link hover:underline" to={`/customers/${e.customer_id}`}>{e.customer_name}</Link>
    : e.customer_name;
  const invoiceLink = e.invoice_id
    ? <Link className="font-mono text-link hover:underline" to={`/invoices/${e.invoice_id}`}>Invoice {data.invoice_number}</Link>
    : null;

  const actions: DetailHeaderAction[] = [];
  if (can.staff && estimateCanInvoice(e)) {
    actions.push({ label: busy ? 'Working…' : 'Create invoice', icon: <FileText className="h-4 w-4" />, onClick: () => void makeInvoice(), disabled: busy });
  }
  if (can.staff && e.status === 'pending') {
    actions.push({ label: 'Mark accepted', icon: <Check className="h-4 w-4" />, variant: 'outline', disabled: busy, onClick: () => setAccepting({ by: '', date: todayLocal() }) });
    actions.push({ label: 'Mark rejected', icon: <X className="h-4 w-4" />, variant: 'outline', disabled: busy, onClick: () => void setStatus('rejected') });
  }
  if (can.staff && (e.status === 'accepted' || e.status === 'rejected')) {
    actions.push({ label: 'Set back to pending', icon: <RotateCcw className="h-4 w-4" />, variant: 'outline', disabled: busy, onClick: () => void setStatus('pending') });
  }

  return (
    <div className="space-y-6">
      <DetailPageHeader
        eyebrow="Estimate"
        title={e.estimate_number}
        subtitle={customerLink}
        status={shown}
        statusLabel={ESTIMATE_STATUS_LABELS[shown]}
        totalLabel="Estimate total"
        total={fmtMoney(e.total)}
        actions={actions}
        menuActions={[
          ...baseDetailMenuActions(),
          { label: 'Save as PDF', icon: <FileDown className="h-4 w-4" />, onSelect: savePdf },
          ...(can.staff && open ? [{ label: 'Edit estimate', icon: <Pencil className="h-4 w-4" />, onSelect: () => nav(`/estimates/${e.id}/edit`) }] : []),
          ...(can.admin && open ? [{ label: 'Delete estimate', icon: <Trash2 className="h-4 w-4" />, onSelect: remove, destructive: true, disabled: busy }] : []),
        ]}
      />

      {accepting && (
        <Card>
          <CardHeader><CardTitle>Mark accepted</CardTitle></CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-end gap-3" onSubmit={ev => {
              ev.preventDefault();
              void setStatus('accepted', { accepted_by: accepting.by.trim() || null, accepted_date: accepting.date });
            }}>
              <div className="space-y-1">
                <Label htmlFor="accepted-by">Accepted by</Label>
                <Input id="accepted-by" value={accepting.by} onChange={ev => setAccepting({ ...accepting, by: ev.target.value })} placeholder="Who accepted it" />
              </div>
              <div className="space-y-1">
                <Label>Accepted date</Label>
                <DateInput value={accepting.date} onChange={ev => setAccepting({ ...accepting, date: ev.target.value })} required />
              </div>
              <Button type="submit" disabled={busy}>Save</Button>
              <Button type="button" variant="outline" onClick={() => setAccepting(null)}>Cancel</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {e.status === 'closed' && invoiceLink && (
        <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          This estimate became {invoiceLink} on {fmtDateTime(e.closed_at)}. It is kept as it was.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <DetailMetric label="Estimate total" value={fmtMoney(e.total)} hint={`${data.lines.length} line${data.lines.length === 1 ? '' : 's'}`} />
        <DetailMetric label="Expiration date" value={e.expiration_date ? fmtLongDate(e.expiration_date) : '—'} hint={shown === 'expired' ? 'Past its expiration date' : 'Until the quote holds'} />
        <DetailMetric label="Status" value={ESTIMATE_STATUS_LABELS[shown]}
          hint={e.status === 'accepted' ? `Accepted${e.accepted_by ? ` by ${e.accepted_by}` : ''}${e.accepted_date ? ` on ${fmtLongDate(e.accepted_date)}` : ''}` : e.status === 'closed' ? 'Made into an invoice' : 'Nothing is in the books yet'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Estimate details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Customer" value={customerLink} />
            <DetailField label="Estimate date" value={fmtLongDate(e.estimate_date)} />
            <DetailField label="Expiration date" value={e.expiration_date ? fmtLongDate(e.expiration_date) : null} />
            <DetailField label="Message to customer" value={e.memo} />
            <DetailField label="Accepted by" value={e.accepted_by} />
            <DetailField label="Accepted date" value={e.accepted_date ? fmtLongDate(e.accepted_date) : null} />
            <DetailField label="Subtotal" value={fmtMoney(e.subtotal)} />
            <DetailField label="Sales tax" value={fmtMoney(e.tax_total)} />
            <DetailField label="Invoice" value={invoiceLink} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <CardContent>
            <DetailActivity items={[
              { label: 'Created', value: fmtDateTime(e.created_at) },
              { label: 'Last updated', value: fmtDateTime(e.updated_at) },
              { label: 'Made into an invoice', value: e.closed_at ? fmtDateTime(e.closed_at) : null },
            ]} />
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
                <td className="p-3 text-right" colSpan={6}>Estimate total</td>
                <td className="p-3 text-right font-mono">{fmtMoney(e.total)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button variant="outline" onClick={() => nav('/estimates')}>Back to estimates</Button>
    </div>
  );
}
