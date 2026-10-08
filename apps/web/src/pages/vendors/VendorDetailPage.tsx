import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, Menu, Plus, Search } from 'lucide-react';
import { hasMinRole } from '@accounting/shared';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyBar } from '@/components/ui/MoneyBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtMoney } from '@/lib/money';
import { fmtDateTime, todayLocal } from '@/lib/dates';

type VendorListItem = { id: string; name: string; is_active: boolean };

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
  is_active: boolean;
  default_terms_days: number;
  has_transactions: boolean;
};
type BillSummary = { id: string; bill_number: string; bill_date: string; due_date: string; status: string; total: string };
type Account = { id: string; name: string };
// Every transaction type this vendor can appear on (bills, checks, expenses,
// journal entries, ...) — the unified transactions endpoint's contact_id
// filter, not just the AP-specific bills list, so Checks/Expenses actually
// show up here instead of only Bills.
type VendorTransaction = {
  id: string; type: string; date: string; ref_no: string | null;
  total_amount: string; status: string; updated_at: string; path: string;
};

const TX_TYPE_LABELS: Record<string, string> = {
  deposit: 'Deposit', expense: 'Expense', check: 'Check', journal: 'Journal Entry',
  bill: 'Bill', payment: 'Payment', credit_memo: 'Credit Memo',
};

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

function VendorSidebar({
  vendors, activeId, collapsed, onToggleCollapsed,
}: { vendors: VendorListItem[]; activeId: string | undefined; collapsed: boolean; onToggleCollapsed: () => void }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? vendors.filter(v => v.name.toLowerCase().includes(q)) : vendors;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [vendors, query]);

  if (collapsed) {
    return (
      <div className="w-12 shrink-0 border-r pt-1">
        <button type="button" onClick={onToggleCollapsed} aria-label="Show vendor list" className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
          <Menu className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r pr-3">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={onToggleCollapsed} aria-label="Hide vendor list" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
          <Menu className="h-4 w-4" />
        </button>
        <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
          <Link to="/ap/vendors/new" aria-label="New vendor"><Plus className="h-4 w-4" /></Link>
        </Button>
      </div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-9 pl-8 text-sm" placeholder="Filter by name" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.map(v => (
          <Link
            key={v.id}
            to={`/ap/vendors/${v.id}`}
            className={`block truncate rounded-md px-2 py-2 text-sm ${v.id === activeId ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground hover:bg-accent/60'}`}
          >
            {v.name}
            {!v.is_active && <span className="ml-1.5 text-xs text-muted-foreground">(inactive)</span>}
          </Link>
        ))}
        {filtered.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">No vendors found</div>}
      </div>
    </div>
  );
}

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [bizId] = useActiveBusinessId();
  const { user, businesses } = useAuth();
  const role = businesses.find(b => b.id === bizId)?.role_override ?? user?.role;
  const canDelete = role !== undefined && hasMinRole(role, 'firm_admin');
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [bills, setBills] = useState<BillSummary[]>([]);
  const [transactions, setTransactions] = useState<VendorTransaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tab, setTab] = useState<string>('transactions');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [vendorList, setVendorList] = useState<VendorListItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!bizId || !id) return;
    api.get(`/businesses/${bizId}/vendors/${id}`).then(r => setVendor(r.data));
    api.get(`/businesses/${bizId}/bills`, { params: { vendor_id: id, limit: 1000 } }).then(r => setBills(r.data.bills));
    api.get(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts));
    api.get(`/businesses/${bizId}/transactions`, { params: { contact_id: id, page_size: 200, sort_key: 'date', sort_dir: 'desc' } })
      .then(r => setTransactions(r.data.transactions));
  }, [bizId, id]);

  // Loaded once per business (not per vendor) so switching vendors via the
  // sidebar doesn't re-fetch the whole list each click.
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/vendors`, { params: { include_inactive: 'true' } }).then(r => setVendorList(r.data.vendors));
  }, [bizId]);

  async function deleteVendor() {
    if (!bizId || !vendor) return;
    if (!window.confirm(`Permanently delete ${vendor.name}? This cannot be undone.`)) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      await api.delete(`/businesses/${bizId}/vendors/${vendor.id}`);
      nav('/ap/vendors');
    } catch (e: unknown) { setDeleteErr(pickErr(e)); }
    finally { setDeleteBusy(false); }
  }

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
    <div className="flex items-start gap-6">
      <VendorSidebar
        vendors={vendorList}
        activeId={vendor.id}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(c => !c)}
      />
      <div className="min-w-0 flex-1 space-y-6">
      <Link to="/ap/vendors" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to vendors
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vendor</div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {vendor.name}
            {!vendor.is_active && <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Inactive</span>}
          </h1>
          {vendor.company_name && <div className="text-sm text-muted-foreground">{vendor.company_name}</div>}
        </div>
        <div className="flex items-start gap-2">
          <div className="mr-4 text-right">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open balance</div>
            <div className="text-2xl font-semibold font-mono">{fmtMoney(String(stats.open + stats.overdue))}</div>
          </div>
          <Button asChild variant="outline"><Link to={`/ap/bill-payments/new?vendor_id=${vendor.id}`}>Pay bills</Link></Button>
          <Button asChild><Link to={`/ap/bills/new?vendor_id=${vendor.id}`}>Create bill</Link></Button>
          <Button
            type="button"
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={!canDelete || vendor.has_transactions || deleteBusy}
            onClick={() => { void deleteVendor(); }}
            title={
              vendor.has_transactions
                ? 'Cannot delete — vendor has existing transactions. Use "Make inactive" instead.'
                : !canDelete ? 'Firm admin access is required' : undefined
            }
          >
            {deleteBusy ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
      {deleteErr && <p className="text-sm text-destructive">{deleteErr}</p>}

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
          {transactions.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              hint="Bills, checks, expenses and payments for this vendor will show up here."
              actionLabel="Create bill"
              actionTo={`/ap/bills/new?vendor_id=${vendor.id}`}
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Type</th>
                  <th className="p-3 text-left">No.</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 text-left">Last modified</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={`${tx.type}:${tx.id}`} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 whitespace-nowrap">{tx.date}</td>
                    <td className="p-3">{TX_TYPE_LABELS[tx.type] ?? tx.type}</td>
                    <td className="p-3 font-mono">{tx.ref_no ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-3 capitalize">{tx.status}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(tx.total_amount)}</td>
                    <td className="p-3 whitespace-nowrap text-muted-foreground">{fmtDateTime(tx.updated_at)}</td>
                    <td className="p-3 text-right">
                      <Link className="text-primary hover:underline" to={tx.path}>View/Edit</Link>
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
    </div>
  );
}
