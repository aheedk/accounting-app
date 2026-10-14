import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronDown, ChevronLeft, FolderOpen, ListFilter, Plus, PanelLeftClose, PanelLeftOpen, Printer, RefreshCw, Search, Settings, SlidersHorizontal, Star } from 'lucide-react';
import { hasMinRole } from '@accounting/shared';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { AppSelect } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyBar } from '@/components/ui/MoneyBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fmtMoney } from '@/lib/money';
import { fmtDateTime, daysAgoLocal, todayLocal } from '@/lib/dates';
import { billOpenAmount } from '@/lib/vendorBalances';
import { formatPhone } from '@/lib/phone';
import { printReport } from '@/lib/reportExport';
import { humanizeCode } from '@/lib/labels';

// open_balance is what is owed, less unused credits and payments (vendorService.listVendors).
type VendorListItem = { id: string; name: string; is_active: boolean; open_balance?: string };

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
type BillSummary = { id: string; bill_number: string; bill_date: string; due_date: string; status: string; total: string; open_balance?: string | null };
type Account = { id: string; code: string; name: string; account_type: string };
// Every transaction type this vendor can appear on (bills, checks, expenses,
// journal entries, ...) — the unified transactions endpoint's contact_id
// filter, not just the AP-specific bills list, so Checks/Expenses actually
// show up here instead of only Bills.
type VendorTransaction = {
  id: string; type: string; date: string; ref_no: string | null;
  total_amount: string; status: string; updated_at: string; path: string;
  // Only a bill has one. A posted bill past it reads Overdue, as on the Bills page.
  due_date?: string | null;
  contact_name: string | null;
  category: string | null;
};

const TX_TYPE_LABELS: Record<string, string> = {
  deposit: 'Deposit', expense: 'Expense', check: 'Check', journal: 'Journal Entry',
  bill: 'Bill', payment: 'Payment', credit_memo: 'Credit Memo',
  invoice: 'Invoice', bill_payment: 'Bill Payment', vendor_credit: 'Vendor Credit',
};

const TABS = [
  { value: 'transactions', label: 'Transaction list' },
  { value: 'details', label: 'Vendor details' },
  { value: 'notes', label: 'Notes' },
] as const;

type VendorNote = { id: string; note_text: string; created_at: string; author_name: string };

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

function SummaryStat({ label, amount, borderClass }: { label: string; amount: number; borderClass: string }) {
  return (
    <div className={`border-l-4 ${borderClass} pl-2.5`}>
      <div className="font-mono text-lg font-semibold">{fmtMoney(String(amount))}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

type VendorSortKey = 'name' | 'balance';

function VendorSidebar({
  vendors, activeId, collapsed, onToggleCollapsed, onStub,
}: {
  vendors: VendorListItem[]; activeId: string | undefined;
  collapsed: boolean; onToggleCollapsed: () => void; onStub: (msg: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<VendorSortKey>('name');

  const openBalanceByVendor = useMemo(
    () => new Map(vendors.map(v => [v.id, Number(v.open_balance ?? 0)])),
    [vendors],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? vendors.filter(v => v.name.toLowerCase().includes(q)) : vendors;
    return [...list].sort((a, b) => (
      sortKey === 'balance'
        ? (openBalanceByVendor.get(b.id) ?? 0) - (openBalanceByVendor.get(a.id) ?? 0)
        : a.name.localeCompare(b.name)
    ));
  }, [vendors, query, sortKey, openBalanceByVendor]);

  if (collapsed) {
    return (
      <div className="sticky top-4 w-12 shrink-0 border-r pt-1 lg:top-6">
        <button type="button" onClick={onToggleCollapsed} aria-label="Show vendor list" className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="sticky top-4 flex max-h-[calc(100vh-2rem)] w-64 shrink-0 flex-col border-r pr-3 lg:top-6 lg:max-h-[calc(100vh-3rem)]">
      <div className="mb-3 flex items-center justify-end gap-1">
        <Button asChild variant="ghost" size="sm" className="h-8 w-8 p-0">
          <Link to="/ap/vendors/new" aria-label="New vendor"><Plus className="h-4 w-4" /></Link>
        </Button>
        <button type="button" onClick={() => onStub('Coming soon')} aria-label="List view options" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
          <ListFilter className="h-4 w-4" />
        </button>
        <button type="button" onClick={onToggleCollapsed} aria-label="Hide vendor list" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-9 pl-8 text-sm" placeholder="Filter by name or details" value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <AppSelect className="mb-2 h-9 rounded-md border bg-background px-3 text-sm font-medium" value={sortKey} onChange={e => setSortKey(e.target.value as VendorSortKey)}>
        <option value="name">Sort by name</option>
        <option value="balance">Sort by open balance</option>
      </AppSelect>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.map(v => (
          <Link
            key={v.id}
            to={`/ap/vendors/${v.id}`}
            className={`block truncate rounded-md px-2 py-2 text-sm ${v.id === activeId ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground hover:bg-accent/60'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">{v.name}{!v.is_active && <span className="ml-1.5 text-xs text-muted-foreground">(inactive)</span>}</span>
            </div>
            <div className="font-mono text-xs text-muted-foreground">{fmtMoney(String(openBalanceByVendor.get(v.id) ?? 0))}</div>
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
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [notes, setNotes] = useState<VendorNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [txTypeFilter, setTxTypeFilter] = useState('all');
  const [recategorizingId, setRecategorizingId] = useState<string | null>(null);

  async function recategorize(tx: VendorTransaction, accountId: string) {
    if (!bizId) return;
    setRecategorizingId(tx.id);
    try {
      // A unified 'check' row can be a real checks-table row or a legacy
      // check-by-expense row (expenseTransactionService) — its own path tells
      // us which, same test the page already relies on for the View/Edit link.
      const isExpenseBacked = tx.type === 'expense' || tx.path.startsWith('/accounting/expenses/');
      const path = isExpenseBacked
        ? `/businesses/${bizId}/expense-transactions/${tx.id}/category`
        : `/businesses/${bizId}/checks/${tx.id}/category`;
      await api.patch(path, { account_id: accountId });
      loadTransactions();
    } catch (e: unknown) { showToast(pickErr(e)); }
    finally { setRecategorizingId(null); }
  }

  function loadNotes() {
    if (!bizId || !id) return;
    setNotesLoading(true);
    api.get(`/businesses/${bizId}/vendors/${id}/notes`)
      .then(r => setNotes(r.data.notes))
      .finally(() => setNotesLoading(false));
  }

  async function saveNote() {
    if (!bizId || !id || !noteDraft.trim()) return;
    setNoteBusy(true);
    try {
      await api.post(`/businesses/${bizId}/vendors/${id}/notes`, { note_text: noteDraft.trim() });
      setNoteDraft('');
      setAddingNote(false);
      loadNotes();
    } finally { setNoteBusy(false); }
  }

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  }

  async function makeInactive() {
    if (!bizId || !vendor) return;
    try {
      await api.patch(`/businesses/${bizId}/vendors/${vendor.id}`, { is_active: false });
      setVendor(v => v && { ...v, is_active: false });
    } catch (e: unknown) { setDeleteErr(pickErr(e)); }
  }

  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeConfirming, setMergeConfirming] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeErr, setMergeErr] = useState<string | null>(null);

  function openMerge() {
    setMergeTargetId('');
    setMergeConfirming(false);
    setMergeErr(null);
    setMergeOpen(true);
  }

  async function confirmMerge() {
    if (!bizId || !vendor || !mergeTargetId) return;
    setMergeBusy(true);
    setMergeErr(null);
    try {
      await api.post(`/businesses/${bizId}/vendors/${vendor.id}/merge`, { into_vendor_id: mergeTargetId });
      nav(`/ap/vendors/${mergeTargetId}`);
    } catch (e: unknown) { setMergeErr(pickErr(e)); setMergeBusy(false); }
  }

  function loadTransactions() {
    if (!bizId || !id) return;
    api.get(`/businesses/${bizId}/transactions`, { params: { contact_id: id, page_size: 200, sort_key: 'date', sort_dir: 'desc' } })
      .then(r => setTransactions(r.data.transactions));
  }

  useEffect(() => {
    if (!bizId || !id) return;
    api.get(`/businesses/${bizId}/vendors/${id}`).then(r => setVendor(r.data));
    api.get(`/businesses/${bizId}/bills`, { params: { vendor_id: id, limit: 1000 } }).then(r => setBills(r.data.bills));
    api.get(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts));
    loadTransactions();
  }, [bizId, id]);

  useEffect(() => { if (tab === 'notes') loadNotes(); }, [bizId, id, tab]);

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
      // An unpaid bill counts for what is left on it; a paid one for its total.
      const amt = b.status === 'posted' ? billOpenAmount(b) : Number(b.total);
      if (b.status === 'posted') {
        if (b.due_date < today) { overdue += amt; overdueCount += 1; }
        else { open += amt; openCount += 1; }
      } else if (b.status === 'paid') { paid += amt; paidCount += 1; }
    }
    return { open, openCount, overdue, overdueCount, paid, paidCount };
  }, [bills, today]);

  const last12mCutoff = daysAgoLocal(365);
  const filteredTransactions = useMemo(
    () => transactions.filter(tx => (txTypeFilter === 'all' || tx.type === txTypeFilter) && tx.date >= last12mCutoff),
    [transactions, txTypeFilter, last12mCutoff],
  );
  const txTotal = useMemo(
    () => filteredTransactions.reduce((sum, tx) => sum + Number(tx.total_amount), 0),
    [filteredTransactions],
  );

  function printTransactions() {
    printReport({
      title: `${vendor?.name ?? 'Vendor'} — Transactions`,
      headers: ['Date', 'Type', 'No.', 'Payee', 'Category', 'Total'],
      rows: filteredTransactions.map(tx => [
        tx.date, TX_TYPE_LABELS[tx.type] ?? tx.type, tx.ref_no ?? '', tx.contact_name ?? '', tx.category ?? '', fmtMoney(tx.total_amount),
      ]),
    });
  }

  const expenseCategory = vendor?.default_expense_account_id
    ? accounts.find(a => a.id === vendor.default_expense_account_id)?.name ?? null
    : null;
  // Same ordering as the expense/check line's own category picker (ExpensePage/CheckPage): expense accounts first.
  const categoryAccounts = [...accounts.filter(a => a.account_type === 'expense'), ...accounts.filter(a => a.account_type !== 'expense')];

  if (!vendor) return <div>Loading…</div>;
  return (
    <div className="flex items-start gap-6">
      <VendorSidebar
        vendors={vendorList}
        activeId={vendor.id}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(c => !c)}
        onStub={showToast}
      />
      <div className="min-w-0 flex-1 space-y-6">
      <Link to="/ap/vendors" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to vendors
      </Link>

      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vendor</div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {vendor.name}
          {!vendor.is_active && <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Inactive</span>}
        </h1>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-6 border-b pb-4">
        <div className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm sm:grid-cols-4">
          <Detail label="Company" value={vendor.company_name} />
          <Detail label="Billing address" value={fmtAddress(vendor.billing_address) || null} />
          <div>
            <div className="text-xs text-muted-foreground">Bill Pay ACH info</div>
            <button type="button" className="mt-0.5 text-sm text-link hover:underline" onClick={() => showToast('Coming soon')}>
              Ask vendor for payment info
            </button>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Notes</div>
            <button type="button" className="mt-0.5 text-sm text-link hover:underline" onClick={() => showToast('Coming soon')}>
              Add notes
            </button>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div className="flex gap-4">
            {/* Unpaid bills less unused credits and payments, as on the Vendors list. */}
            <SummaryStat label="Open balance" amount={Number(vendorList.find(v => v.id === vendor.id)?.open_balance ?? stats.open + stats.overdue)} borderClass="border-amber-400" />
            <SummaryStat label="Overdue payment" amount={stats.overdue} borderClass="border-red-500" />
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex">
              <Button asChild variant="outline" className="rounded-r-none border-r-0">
                <Link to={`/ap/vendors/${vendor.id}/edit`}>Edit</Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className="rounded-l-none px-2" aria-label="More vendor actions">
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem disabled={!vendor.is_active} onSelect={() => { void makeInactive(); }}>
                    Make inactive
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!canDelete} title={!canDelete ? 'Firm admin access is required' : undefined} onSelect={openMerge}>
                    Merge contacts
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => showToast('Coming soon')}>Ask vendor for info</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    disabled={!canDelete || vendor.has_transactions || deleteBusy}
                    onSelect={() => { void deleteVendor(); }}
                    title={
                      vendor.has_transactions
                        ? 'Cannot delete — vendor has existing transactions. Use "Make inactive" instead.'
                        : !canDelete ? 'Firm admin access is required' : undefined
                    }
                  >
                    {deleteBusy ? 'Deleting…' : 'Delete'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button">
                  New transaction <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild><Link to={`/ap/bills/new?vendor_id=${vendor.id}`}>Create bill</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to={`/accounting/expenses/new?vendor_id=${vendor.id}`}>Create expense</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to={`/accounting/checks/new?vendor_id=${vendor.id}`}>Write check</Link></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      {deleteErr && <p className="text-sm text-destructive">{deleteErr}</p>}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg">
          {toastMsg}
        </div>
      )}

      <Dialog open={mergeOpen} onOpenChange={o => { if (!mergeBusy) setMergeOpen(o); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Merge {vendor.name} with another vendor</DialogTitle></DialogHeader>
          <div className="space-y-4 p-6">
            {!mergeConfirming ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Pick the vendor to merge <span className="font-medium text-foreground">{vendor.name}</span> into. That vendor survives; its own details stay as they are.
                </p>
                <AppSelect
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={mergeTargetId}
                  onChange={e => setMergeTargetId(e.target.value)}
                >
                  <option value="">Choose a vendor</option>
                  {vendorList.filter(v => v.id !== vendor.id).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </AppSelect>
              </>
            ) : (
              <p className="text-sm">
                This will merge <span className="font-medium">{vendor.name}</span> into{' '}
                <span className="font-medium">{vendorList.find(v => v.id === mergeTargetId)?.name}</span>. All transactions currently
                linked to <span className="font-medium">{vendor.name}</span> will be moved to{' '}
                <span className="font-medium">{vendorList.find(v => v.id === mergeTargetId)?.name}</span>, and{' '}
                <span className="font-medium">{vendor.name}</span> will be permanently deleted. This cannot be undone.
              </p>
            )}
            {mergeErr && <p className="text-sm text-destructive">{mergeErr}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMergeOpen(false)} disabled={mergeBusy}>Cancel</Button>
            {!mergeConfirming ? (
              <Button type="button" disabled={!mergeTargetId} onClick={() => setMergeConfirming(true)}>Continue</Button>
            ) : (
              <Button type="button" variant="destructive" disabled={mergeBusy} onClick={() => { void confirmMerge(); }}>
                {mergeBusy ? 'Merging…' : 'Merge'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MoneyBar segments={[
        { amount: stats.overdue, caption: `${stats.overdueCount} overdue`, colorClass: 'bg-orange-400' },
        { amount: stats.open, caption: `${stats.openCount} not due yet`, colorClass: 'bg-gray-300' },
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
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <AppSelect className="h-9 rounded-md border bg-background px-3 text-sm" value={txTypeFilter} onChange={e => setTxTypeFilter(e.target.value)}>
                <option value="all">All transactions</option>
                {Object.entries(TX_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </AppSelect>
              <Button type="button" variant="outline" size="sm" onClick={() => showToast('Coming soon')}>
                <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" /> Filter
              </Button>
              <span className="inline-flex h-9 items-center rounded-full border bg-muted/50 px-3 text-sm text-muted-foreground">
                Dates: Last 12 months
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Print" onClick={printTransactions} className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                <Printer className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Table settings" onClick={() => showToast('Coming soon')} className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </div>

          <Card><CardContent className="p-0">
            {filteredTransactions.length === 0 ? (
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
                    <th className="p-3 text-left">Payee</th>
                    <th className="p-3 text-left">Category</th>
                    <th className="p-3 text-right">Total</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map(tx => (
                    <tr key={`${tx.type}:${tx.id}`} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="p-3 whitespace-nowrap">{tx.date}</td>
                      <td className="p-3">{TX_TYPE_LABELS[tx.type] ?? tx.type}</td>
                      <td className="p-3 font-mono">{tx.ref_no ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-3">{tx.contact_name ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-3">
                        {(tx.type === 'expense' || tx.type === 'check') && tx.category && tx.category !== 'Split' ? (
                          <AppSelect
                            className="h-8 w-full max-w-[16rem] rounded-md border bg-background px-2 text-sm disabled:opacity-60"
                            value={categoryAccounts.find(a => a.name === tx.category)?.id ?? ''}
                            disabled={recategorizingId === tx.id}
                            onChange={e => { if (e.target.value) { void recategorize(tx, e.target.value); } }}
                          >
                            {categoryAccounts.map(a => (
                              <option key={a.id} value={a.id} data-hint={humanizeCode(a.account_type)}>
                                {a.code} {a.name}
                              </option>
                            ))}
                          </AppSelect>
                        ) : (
                          <div
                            title={tx.category === 'Split' ? 'This transaction has more than one category — open it to edit.' : 'Editing the category here isn’t supported for this transaction type.'}
                            className="flex h-8 max-w-[16rem] cursor-not-allowed items-center justify-between gap-1 rounded-md border bg-muted/40 px-2 text-sm text-muted-foreground"
                          >
                            <span className="truncate">{tx.category ?? '—'}</span>
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono">{fmtMoney(tx.total_amount)}</td>
                      <td className="p-3 text-right">
                        <Link className="text-link hover:underline" to={tx.path}>View/Edit</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-medium">
                    <td className="p-3" colSpan={5}>Total</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(String(txTotal))}</td>
                    <td className="p-3"></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent></Card>
        </div>
      )}

      {tab === 'details' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm"><Link to={`/ap/vendors/${vendor.id}/edit`}>Edit</Link></Button>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card><CardContent className="space-y-4 pt-6">
            <div className="text-sm font-semibold">Contact</div>
            <div className="grid grid-cols-2 gap-4">
              <Detail label="Email" value={vendor.email} />
              <Detail label="Cc" value={vendor.email_cc} />
              <Detail label="Phone" value={vendor.phone ? formatPhone(vendor.phone) : vendor.phone} />
              <Detail label="Mobile" value={vendor.mobile ? formatPhone(vendor.mobile) : vendor.mobile} />
              <Detail label="Fax" value={vendor.fax ? formatPhone(vendor.fax) : vendor.fax} />
              <Detail label="Other" value={vendor.other_phone ? formatPhone(vendor.other_phone) : vendor.other_phone} />
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
            <div className="text-sm font-semibold">Additional info</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Bill Pay ACH info</div>
                <button type="button" className="mt-0.5 text-sm text-link hover:underline" onClick={() => showToast('Coming soon')}>
                  Ask vendor for payment info
                </button>
              </div>
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
                  ? <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-link">Tracked for 1099</span>
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
        </div>
      )}

      {tab === 'notes' && (
        <Card><CardContent className="p-0">
          <div className="flex items-center justify-between border-b p-3">
            <div className="flex items-center gap-3 text-muted-foreground">
              <button type="button" aria-label="Favorite this vendor" onClick={() => showToast('Coming soon')} className="hover:text-foreground">
                <Star className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Refresh notes" onClick={loadNotes} className="hover:text-foreground">
                <RefreshCw className={`h-4 w-4 ${notesLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <Button type="button" size="sm" onClick={() => setAddingNote(a => !a)}>+ Add note</Button>
          </div>

          {addingNote && (
            <div className="space-y-2 border-b p-4">
              <textarea
                autoFocus
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value)}
                rows={3}
                placeholder="Write a note about this vendor…"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={noteBusy || !noteDraft.trim()} onClick={() => { void saveNote(); }}>
                  {noteBusy ? 'Saving…' : 'Save'}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setAddingNote(false); setNoteDraft(''); }}>Cancel</Button>
              </div>
            </div>
          )}

          {notes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <FolderOpen className="h-10 w-10" />
              <div className="text-sm">No notes yet</div>
            </div>
          ) : (
            <div className="divide-y">
              {notes.map(n => (
                <div key={n.id} className="p-4">
                  <div className="text-xs text-muted-foreground">{fmtDateTime(n.created_at)} · {n.author_name}</div>
                  <div className="mt-1 whitespace-pre-line text-sm">{n.note_text}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent></Card>
      )}
      </div>
    </div>
  );
}
