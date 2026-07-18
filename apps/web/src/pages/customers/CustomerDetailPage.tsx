import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CreditCard, FileText } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailActivity, DetailField, DetailMetric, DetailPageHeader, DetailStatusBadge, baseDetailMenuActions } from '@/components/ui/detail-page';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtDateTime, fmtLongDate, todayLocal } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';

type Address = { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string };
type Customer = {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  website?: string | null;
  billing_address?: Address | null;
  shipping_address?: Address | null;
  notes?: string | null;
  opening_balance?: string | null;
  opening_balance_as_of?: string | null;
  default_terms_days: number;
  created_at?: string;
  updated_at?: string;
};
type InvoiceSummary = { id: string; invoice_number: string; issue_date: string; due_date: string; status: string; total: string };

function fmtAddress(a: Address | null | undefined): string {
  if (!a) return '';
  const cityLine = [a.city, a.state, a.postal_code].filter(Boolean).join(', ');
  return [a.line1, a.line2, cityLine, a.country].filter(Boolean).join('\n');
}

function termsLabel(days: number): string {
  return days === 0 ? 'Due on receipt' : `Net ${days}`;
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);

  useEffect(() => {
    if (!bizId || !id) return;
    api.get(`/businesses/${bizId}/customers/${id}`).then(r => setCustomer(r.data));
    api.get(`/businesses/${bizId}/invoices`, { params: { customer_id: id } }).then(r => setInvoices(r.data.invoices));
  }, [bizId, id]);

  const stats = useMemo(() => {
    const today = todayLocal();
    let open = 0;
    let overdue = 0;
    let paid = 0;
    for (const i of invoices) {
      const amount = Number(i.total);
      if (i.status === 'posted') {
        if (i.due_date < today) overdue += amount;
        else open += amount;
      } else if (i.status === 'paid') {
        paid += amount;
      }
    }
    return { open, overdue, paid };
  }, [invoices]);

  if (!customer) return <div>Loading...</div>;

  const openBalance = stats.open + stats.overdue;

  return (
    <div className="space-y-6">
      <DetailPageHeader
        eyebrow="Customer"
        title={customer.name}
        subtitle={customer.company_name || customer.email || 'Customer profile'}
        totalLabel="Open balance"
        total={fmtMoney(openBalance)}
        actions={[
          { label: 'Receive payment', icon: <CreditCard className="h-4 w-4" />, to: `/payments/new?customer_id=${customer.id}`, variant: 'outline' },
          { label: 'New invoice', icon: <FileText className="h-4 w-4" />, to: `/invoices/new?customer_id=${customer.id}` },
        ]}
        menuActions={baseDetailMenuActions()}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <DetailMetric label="Open" value={fmtMoney(stats.open)} hint="Not yet overdue" />
        <DetailMetric label="Overdue" value={fmtMoney(stats.overdue)} hint="Open invoices past due" />
        <DetailMetric label="Paid" value={fmtMoney(stats.paid)} hint="Paid invoices on record" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
            <DetailField label="Company" value={customer.company_name} />
            <DetailField label="Terms" value={termsLabel(customer.default_terms_days)} />
            <DetailField label="Email" value={customer.email ? <a className="text-primary hover:underline" href={`mailto:${customer.email}`}>{customer.email}</a> : null} />
            <DetailField label="Phone" value={customer.phone} />
            <DetailField label="Website" value={customer.website ? <a className="text-primary hover:underline" href={customer.website}>{customer.website}</a> : null} />
            <DetailField label="Opening balance" value={customer.opening_balance ? `${fmtMoney(customer.opening_balance)}${customer.opening_balance_as_of ? ` as of ${fmtLongDate(customer.opening_balance_as_of)}` : ''}` : null} />
            <DetailField label="Billing address" value={fmtAddress(customer.billing_address)} />
            <DetailField label="Shipping address" value={fmtAddress(customer.shipping_address)} />
            <DetailField label="Notes" className="sm:col-span-2" value={customer.notes} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <CardContent>
            <DetailActivity
              items={[
                { label: 'Created', value: customer.created_at ? fmtDateTime(customer.created_at) : null },
                { label: 'Last updated', value: customer.updated_at ? fmtDateTime(customer.updated_at) : null },
                { label: 'Invoices', value: invoices.length ? `${invoices.length} total` : null },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <EmptyState
              title="No invoices yet"
              hint="Invoices for this customer will show up here."
              actionLabel="New invoice"
              actionTo={`/invoices/new?customer_id=${customer.id}`}
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="p-3 text-left">Invoice</th>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Due date</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(i => (
                  <tr key={i.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-mono">
                      <Link className="text-primary hover:underline" to={`/invoices/${i.id}`}>{i.invoice_number}</Link>
                    </td>
                    <td className="p-3 whitespace-nowrap">{fmtLongDate(i.issue_date)}</td>
                    <td className="p-3 whitespace-nowrap">{fmtLongDate(i.due_date)}</td>
                    <td className="p-3"><DetailStatusBadge status={i.status} /></td>
                    <td className="p-3 text-right font-mono">{fmtMoney(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
