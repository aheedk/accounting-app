import { useEffect, useRef, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseMoneyInput } from '@/lib/money';
import { todayLocal } from '@/lib/dates';

type LinkTarget = 'invoice' | 'sales_order';

type InvoiceRow = {
  id: string;
  invoice_number: string;
  total: string;
  issue_date: string;
};

type SalesOrderRow = {
  id: string;
  so_number: string;
  order_date: string;
};

type FileRow = { id: string };

type CreateBody = {
  invoice_id?: string;
  sales_order_id?: string;
  carrier: string;
  tracking_number: string;
  shipped_at: string;
  cost?: string;
  label_file_id?: string;
  notes?: string;
};

function pickErr(e: unknown): string {
  return (
    (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
      ?.response?.data?.error?.message ??
    (e instanceof Error ? e.message : undefined) ??
    'Failed'
  );
}

function today(): string {
  return todayLocal();
}

export default function ShippingLabelNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrderRow[]>([]);

  const [linkTarget, setLinkTarget] = useState<LinkTarget>('invoice');
  const [invoiceId, setInvoiceId] = useState('');
  const [salesOrderId, setSalesOrderId] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [shippedAt, setShippedAt] = useState(today());
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [labelFile, setLabelFile] = useState<File | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api
      .get<{ invoices: InvoiceRow[] }>(`/businesses/${bizId}/invoices`, { params: { status: 'posted' } })
      .then((r) => setInvoices(r.data.invoices))
      .catch(() => { /* non-fatal — user can still pick SO */ });
    api
      .get<{ sales_orders: SalesOrderRow[] }>(`/businesses/${bizId}/sales-orders`, { params: { status: 'fulfilled' } })
      .then((r) => setSalesOrders(r.data.sales_orders))
      .catch(() => { /* non-fatal */ });
  }, [bizId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId) return;
    setErr(null);
    setBusy(true);
    try {
      if (linkTarget === 'invoice' && !invoiceId) {
        throw new Error('Select an invoice to label.');
      }
      if (linkTarget === 'sales_order' && !salesOrderId) {
        throw new Error('Select a sales order to label.');
      }
      if (carrier.trim() === '') throw new Error('Carrier is required.');
      if (trackingNumber.trim() === '') throw new Error('Tracking number is required.');

      // If a label file was attached, upload it FIRST so we can pass label_file_id with the create body.
      let labelFileId: string | undefined;
      if (labelFile) {
        const fd = new FormData();
        fd.append('file', labelFile);
        const fr = await api.post<FileRow>(`/businesses/${bizId}/files`, fd);
        labelFileId = fr.data.id;
      }

      const body: CreateBody = {
        carrier: carrier.trim(),
        tracking_number: trackingNumber.trim(),
        shipped_at: shippedAt,
      };
      if (linkTarget === 'invoice') body.invoice_id = invoiceId;
      else body.sales_order_id = salesOrderId;
      if (cost.trim() !== '') body.cost = parseMoneyInput(cost);
      if (labelFileId) body.label_file_id = labelFileId;
      if (notes.trim() !== '') body.notes = notes;

      await api.post(`/businesses/${bizId}/shipping-labels`, body);
      nav('/inventory/shipping-labels');
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <form className="space-y-6" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Shipping Label</h1>

      <Card>
        <CardHeader>
          <CardTitle>Link to</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="linkTarget"
                value="invoice"
                checked={linkTarget === 'invoice'}
                onChange={() => { setLinkTarget('invoice'); setSalesOrderId(''); }}
              />
              Invoice
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="linkTarget"
                value="sales_order"
                checked={linkTarget === 'sales_order'}
                onChange={() => { setLinkTarget('sales_order'); setInvoiceId(''); }}
              />
              Sales Order
            </label>
          </div>

          {linkTarget === 'invoice' && (
            <div>
              <Label>Posted invoice</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} · {inv.issue_date} · {inv.total}
                  </option>
                ))}
              </select>
              {invoices.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">No posted invoices available.</p>
              )}
            </div>
          )}

          {linkTarget === 'sales_order' && (
            <div>
              <Label>Fulfilled sales order</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={salesOrderId}
                onChange={(e) => setSalesOrderId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {salesOrders.map((so) => (
                  <option key={so.id} value={so.id}>
                    {so.so_number} · {so.order_date}
                  </option>
                ))}
              </select>
              {salesOrders.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">No fulfilled sales orders available.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Label details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div>
            <Label>Carrier</Label>
            <Input
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="UPS, FedEx, USPS…"
              required
            />
          </div>
          <div>
            <Label>Tracking #</Label>
            <Input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Shipped at</Label>
            <DateInput
              value={shippedAt}
              onChange={(e) => setShippedAt(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Cost (optional)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label>Label file (PDF/image, optional)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm hover:file:bg-muted"
              onChange={(e) => setLabelFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <textarea
              className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Create label'}
        </Button>
        <Button type="button" variant="outline" onClick={() => nav('/inventory/shipping-labels')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
