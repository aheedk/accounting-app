import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MoneyBar } from '@/components/ui/MoneyBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';

type Address = { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string };
type Vendor = {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  email_cc: string | null;
  phone: string | null;
  mobile: string | null;
  fax: string | null;
  other_phone: string | null;
  website: string | null;
  name_on_checks: string | null;
  billing_address: Address | null;
  notes: string | null;
  account_number: string | null;
  default_expense_account_id: string | null;
  opening_balance: string | null;
  opening_balance_as_of: string | null;
  tax_id_last_four: string | null;
  tax_id_type: 'SSN' | 'EIN' | null;
  is_1099: boolean;
  default_terms_days: number;
};
type BillSummary = { id: string; bill_number: string; bill_date: string; due_date: string; status: string; total: string };
type Account = { id: string; name: string };

const TABS = [
  { value: 'transactions', label: 'Transaction list' },
  { value: 'details', label: 'Vendor details' },
] as const;

function fmtAddress(a: Address | null | undefined): string {
  if (!a) return '';
  const cityLine = [a.city, a.state, a.postal_code].filter(Boolean).join(', ');
  return [a.line1, a.line2, cityLine, a.country].filter(Boolean).join('\n');
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 whitespace-pre-line text-sm">{value ?? <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [bills, setBills] = useState<BillSummary[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tab, setTab] = useState<string>('transactions');

  useEffect(() => {
    if (!bizId || !id) return;
    api.get(`/businesses/${bizId}/vendors/${id}`).then(r => setVendor(r.data));
    api.get(`/businesses/${bizId}/bills`, { params: { vendor_id: id, limit: 1000 } }).then(r => setBills(r.data.bills));
    api.get(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts));
  }, [bizId, id]);

  const today = todayLocal();
  const stats = useMemo(() => {
    let open = 0, openCount = 0, overdue = 0, overdueCount = 0, paid = 0, paidCount = 0;
    for (const b of bills) {
      const amt = Number(b.total);
      if (b.status === 'posted') {
        if (b.due_date < today) { overdue += amt; overdueCount += 1; }
        else { open += amt; openCount += 1; }
      } else if (b.status === 'paid') { paid += amt; paidCount += 1; }
    }
    return { open, openCount, overdue, overdueCount, paid, paidCount };
  }, [bills, today]);

  const expenseCategory = vendor?.default_expense_account_id
    ? accounts.find(a => a.id === vendor.default_expense_account_id)?.name ?? null
    : null;

  if (!vendor) return <div>Loading…</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vendor</div>
          <h1 className="text-2xl font-semibold">{vendor.name}</h1>
          {vendor.company_name && <div className="text-sm text-muted-foreground">{vendor.company_name}</div>}
        </div>
        <div className="flex items-start gap-2">
          <div className="mr-4 text-right">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open balance</div>
            <div className="text-2xl font-semibold font-mono">{fmtMoney(String(stats.open + stats.overdue))}</div>
          </div>
          <Button asChild variant="outline"><Link to={`/ap/bill-payments/new?vendor_id=${vendor.id}`}>Pay bills</Link></Button>
          <Button asChild><Link to={`/ap/bills/new?vendor_id=${vendor.id}`}>Create bill</Link></Button>
        </div>
      </div>

      <MoneyBar segments={[
        { amount: stats.overdue, caption: `${stats.overdueCount} overdue`, colorClass: 'bg-orange-400' },
        { amount: stats.open, caption: `${stats.openCount} open bill${stats.openCount === 1 ? '' : 's'}`, colorClass: 'bg-gray-300' },
        { amount: stats.paid, caption: `${stats.paidCount} paid`, colorClass: 'bg-green-600' },
      ]} />

      <div className="inline-flex rounded-md border bg-background p-0.5">
        {TABS.map(t => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`rounded px-4 py-1.5 text-sm font-medium ${tab === t.value ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'transactions' && (
        <Card><CardContent className="p-0">
          {bills.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              hint="Bills and payments for this vendor will show up here."
              actionLabel="Create bill"
              actionTo={`/ap/bills/new?vendor_id=${vendor.id}`}
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 text-left">No.</th>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Due date</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {bills.map(b => (
                  <tr key={b.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-mono">{b.bill_number}</td>
                    <td className="p-3 whitespace-nowrap">{b.bill_date}</td>
                    <td className="p-3 whitespace-nowrap">{b.due_date}</td>
                    <td className="p-3 capitalize">{b.status === 'posted' ? 'Open' : b.status}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(b.total)}</td>
                    <td className="p-3 text-right">
                      <Link className="text-primary hover:underline" to={`/ap/bills/${b.id}`}>View/Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent></Card>
      )}

      {tab === 'details' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card><CardContent className="space-y-4 pt-6">
            <div className="text-sm font-semibold">Contact</div>
            <div className="grid grid-cols-2 gap-4">
              <Detail label="Email" value={vendor.email} />
              <Detail label="Cc" value={vendor.email_cc} />
              <Detail label="Phone" value={vendor.phone} />
              <Detail label="Mobile" value={vendor.mobile} />
              <Detail label="Fax" value={vendor.fax} />
              <Detail label="Other" value={vendor.other_phone} />
              <Detail label="Website" value={vendor.website} />
              <Detail label="Name on checks" value={vendor.name_on_checks} />
            </div>
            <div className="text-sm font-semibold pt-2">Address</div>
            <Detail label="Mailing address" value={fmtAddress(vendor.billing_address) || null} />
            {vendor.notes && (
              <>
                <div className="text-sm font-semibold pt-2">Notes</div>
                <div className="whitespace-pre-line text-sm text-muted-foreground">{vendor.notes}</div>
              </>
            )}
          </CardContent></Card>

          <Card><CardContent className="space-y-4 pt-6">
            <div className="text-sm font-semibold">Payments &amp; tax</div>
            <div className="grid grid-cols-2 gap-4">
              <Detail label="Terms" value={vendor.default_terms_days === 0 ? 'Due on receipt' : `Net ${vendor.default_terms_days}`} />
              <Detail label="Account no." value={vendor.account_number} />
              <Detail label="Default expense category" value={expenseCategory} />
              <Detail
                label="Tax ID"
                value={vendor.tax_id_last_four ? `${vendor.tax_id_type ?? ''} ••• ${vendor.tax_id_last_four}` : null}
              />
              <Detail
                label="1099 tracking"
                value={vendor.is_1099
                  ? <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Tracked for 1099</span>
                  : 'Not tracked'}
              />
              <Detail
                label="Opening balance"
                value={vendor.opening_balance
                  ? <span className="font-mono">{fmtMoney(vendor.opening_balance)}{vendor.opening_balance_as_of ? ` as of ${vendor.opening_balance_as_of}` : ''}</span>
                  : null}
              />
            </div>
          </CardContent></Card>
        </div>
      )}
    </div>
  );
}
