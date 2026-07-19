import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, CreditCard, FileDown, Printer, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import type { Role } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type BankTransactionStatus = 'unreviewed' | 'matched' | 'categorized' | 'excluded';
type StatusFilter = BankTransactionStatus | 'all';

type BankAccount = {
  id: string;
  name: string;
  institution: string | null;
  account_last_four: string | null;
  cash_account_id: string;
  is_active: boolean;
};

type BankTransaction = {
  id: string;
  business_id: string;
  bank_account_id: string;
  transaction_date: string;
  description: string;
  amount: string;
  external_id: string | null;
  status: BankTransactionStatus;
  matched_journal_entry_id: string | null;
  excluded_reason: string | null;
  is_reconciled: boolean;
};

type JournalEntry = {
  id: string;
  entry_date: string;
  memo: string | null;
  status: string;
  source_type: string;
  reference: string | null;
};

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_system: boolean;
  is_active: boolean;
};

type ActionMode = 'match' | 'categorize' | 'exclude';

type ActionFormState = {
  txnId: string;
  mode: ActionMode;
  journal_entry_id: string;
  offset_account_id: string;
  memo: string;
  excluded_reason: string;
};

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

const ROLE_RANK: Record<Role, number> = {
  client: 0,
  staff: 1,
  accountant: 2,
  firm_admin: 3,
};

function roleAtLeast(role: Role | undefined, floor: Role): boolean {
  if (!role) return false;
  const r = ROLE_RANK[role] ?? -1;
  const f = ROLE_RANK[floor] ?? Number.POSITIVE_INFINITY;
  return r >= f;
}

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'unreviewed', label: 'For review' },
  { value: 'categorized', label: 'Categorized' },
  { value: 'excluded', label: 'Excluded' },
];

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

function statusBadge(status: BankTransactionStatus) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  switch (status) {
    case 'unreviewed':
      return <span className={`${base} bg-amber-100 text-amber-800`}>For review</span>;
    case 'matched':
      return <span className={`${base} bg-blue-100 text-blue-800`}>Matched</span>;
    case 'categorized':
      return <span className={`${base} bg-emerald-100 text-emerald-800`}>Categorized</span>;
    case 'excluded':
      return <span className={`${base} bg-muted text-muted-foreground`}>Excluded</span>;
    default:
      return <span className={base}>{status}</span>;
  }
}

function defaultOffsetType(amount: string): 'revenue' | 'expense' {
  const n = parseFloat(amount);
  if (Number.isFinite(n) && n >= 0) return 'revenue';
  return 'expense';
}

const DATE_PRESETS = [
  { value: 'all', label: 'All dates' },
  { value: 'custom', label: 'Custom' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'this_year', label: 'This year' },
  { value: 'last_week', label: 'Last week' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_quarter', label: 'Last quarter' },
  { value: 'last_year', label: 'Last year' },
];

const TXN_TYPE_OPTIONS = [
  { value: 'all', label: 'All transactions' },
  { value: 'money_in', label: 'Money in' },
  { value: 'money_out', label: 'Money out' },
  { value: 'suggested_matches', label: 'Suggested matches' },
  { value: 'transfers', label: 'Transfers' },
  { value: 'rules', label: 'Rules' },
  { value: 'missing_payee', label: 'Missing payee/customer' },
  { value: 'uncategorized', label: 'Uncategorized' },
];

function isoToDisplay(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${m}/${d}/${y}` : iso;
}

function getPresetRange(preset: string): { from: string; to: string } | null {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  const ymd = (yr: number, mn: number, dy: number) => iso(new Date(yr, mn, dy));
  switch (preset) {
    case 'all':
    case 'custom':
      return null;
    case 'today': { const t = ymd(y, mo, d); return { from: t, to: t }; }
    case 'yesterday': { const t = ymd(y, mo, d - 1); return { from: t, to: t }; }
    case 'this_week': {
      const dow = now.getDay();
      const mon = new Date(now); mon.setDate(d - (dow === 0 ? 6 : dow - 1));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return { from: iso(mon), to: iso(sun) };
    }
    case 'this_month': return { from: ymd(y, mo, 1), to: ymd(y, mo + 1, 0) };
    case 'this_quarter': { const q = Math.floor(mo / 3); return { from: ymd(y, q * 3, 1), to: ymd(y, q * 3 + 3, 0) }; }
    case 'this_year': return { from: ymd(y, 0, 1), to: ymd(y, 11, 31) };
    case 'last_week': {
      const dow = now.getDay();
      const mon = new Date(now); mon.setDate(d - (dow === 0 ? 6 : dow - 1) - 7);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return { from: iso(mon), to: iso(sun) };
    }
    case 'last_month': return { from: ymd(y, mo - 1, 1), to: ymd(y, mo, 0) };
    case 'last_quarter': {
      const q = Math.floor(mo / 3);
      const lq = q === 0 ? 3 : q - 1;
      const lqy = q === 0 ? y - 1 : y;
      return { from: ymd(lqy, lq * 3, 1), to: ymd(lqy, lq * 3 + 3, 0) };
    }
    case 'last_year': return { from: ymd(y - 1, 0, 1), to: ymd(y - 1, 11, 31) };
    default: return null;
  }
}

export default function BankTransactionsInboxPage() {
  const [bizId] = useActiveBusinessId();
  const { user } = useAuth();
  const canUnreview = roleAtLeast(user?.role, 'accountant');

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('unreviewed');
  const [txns, setTxns] = useState<BankTransaction[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [action, setAction] = useState<ActionFormState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedDateFrom, setAppliedDateFrom] = useState('');
  const [appliedDateTo, setAppliedDateTo] = useState('');
  const [showDatePanel, setShowDatePanel] = useState(false);
  const [txnTypeFilter, setTxnTypeFilter] = useState('all');
  const datePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bizId) return;
    (async () => {
      try {
        const r = await api.get(`/businesses/${bizId}/bank-accounts`);
        const list: BankAccount[] = r.data.bank_accounts;
        setBankAccounts(list);
        if (list.length > 0 && !bankAccountId) {
          const first = list[0];
          if (first) setBankAccountId(first.id);
        }
      } catch (e: unknown) {
        setErr(pickErr(e));
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizId]);

  useEffect(() => {
    if (!bizId) return;
    (async () => {
      try {
        const [je, coa] = await Promise.all([
          api.get(`/businesses/${bizId}/journal-entries`, { params: { limit: 50 } }),
          api.get(`/businesses/${bizId}/coa`),
        ]);
        setJournalEntries(je.data.entries);
        setAccounts(coa.data.accounts);
      } catch (e: unknown) {
        setErr(pickErr(e));
      }
    })();
  }, [bizId]);

  const reload = useMemo(() => async () => {
    if (!bizId || !bankAccountId) { setTxns([]); return; }
    setLoading(true);
    try {
      const params: { bank_account_id: string; status?: BankTransactionStatus } = { bank_account_id: bankAccountId };
      if (statusFilter !== 'all') params.status = statusFilter;
      const r = await api.get(`/businesses/${bizId}/bank-transactions`, { params });
      setTxns(r.data.bank_transactions);
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setLoading(false);
    }
  }, [bizId, bankAccountId, statusFilter]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (datePanelRef.current && !datePanelRef.current.contains(e.target as Node)) {
        setShowDatePanel(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function openAction(t: BankTransaction, mode: ActionMode) {
    setErr(null);
    const defaultType = defaultOffsetType(t.amount);
    const defaultAcct = accounts.find(a => a.account_type === defaultType && a.is_active)?.id ?? '';
    setAction({
      txnId: t.id,
      mode,
      journal_entry_id: '',
      offset_account_id: defaultAcct,
      memo: '',
      excluded_reason: '',
    });
  }

  function closeAction() { setAction(null); setErr(null); }

  async function submitMatch(e: React.FormEvent) {
    e.preventDefault();
    if (!action || !bizId) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/bank-transactions/${action.txnId}/match`, {
        journal_entry_id: action.journal_entry_id,
      });
      closeAction();
      await reload();
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  async function submitCategorize(e: React.FormEvent) {
    e.preventDefault();
    if (!action || !bizId) return;
    setBusy(true); setErr(null);
    try {
      const body: { offset_account_id: string; memo?: string } = { offset_account_id: action.offset_account_id };
      if (action.memo.trim()) body.memo = action.memo.trim();
      await api.post(`/businesses/${bizId}/bank-transactions/${action.txnId}/categorize`, body);
      closeAction();
      await reload();
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  async function submitExclude(e: React.FormEvent) {
    e.preventDefault();
    if (!action || !bizId) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/bank-transactions/${action.txnId}/exclude`, {
        excluded_reason: action.excluded_reason.trim(),
      });
      closeAction();
      await reload();
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  async function unreview(t: BankTransaction) {
    if (!bizId) return;
    if (!window.confirm(`Unreview this transaction? Any linked JE (${t.matched_journal_entry_id ?? '—'}) must be handled separately for categorized rows.`)) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/bank-transactions/${t.id}/unreview`);
      await reload();
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  function handleExcel() {
    setExcelBusy(true);
    try {
      downloadAsExcel(
        ['Date', 'Description', 'Spent', 'Received', 'Status', 'Reconciled'],
        txns.map(t => {
          const n = parseFloat(t.amount);
          const spent = Number.isFinite(n) && n < 0 ? fmtMoney(Math.abs(n)) : '';
          const received = Number.isFinite(n) && n >= 0 ? fmtMoney(n) : '';
          return [t.transaction_date, t.description, spent, received, t.status, t.is_reconciled ? 'Yes' : 'No'];
        }),
        'bank-transactions'
      );
    } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const hdrs = ['Date', 'Description', 'Spent', 'Received', 'Status'];
    const rowsHtml = txns.map(t => {
      const n = parseFloat(t.amount);
      const spent = Number.isFinite(n) && n < 0 ? fmtMoney(Math.abs(n)) : '';
      const received = Number.isFinite(n) && n >= 0 ? fmtMoney(n) : '';
      return `<tr><td>${t.transaction_date}</td><td>${t.description}</td><td>${spent}</td><td>${received}</td><td>${t.status}</td></tr>`;
    }).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Bank Transactions</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Bank Transactions</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${hdrs.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  const groupedAccounts = useMemo(() => {
    const groups: Record<string, Account[]> = {};
    for (const a of accounts) {
      if (!a.is_active) continue;
      const key = a.account_type;
      const bucket = groups[key] ?? [];
      bucket.push(a);
      groups[key] = bucket;
    }
    for (const k of Object.keys(groups)) {
      groups[k] = (groups[k] ?? []).slice().sort((x, y) => x.code.localeCompare(y.code));
    }
    return groups;
  }, [accounts]);

  const txnsByAccount = useMemo(() => {
    const map: Record<string, BankTransaction[]> = {};
    for (const t of txns) {
      (map[t.bank_account_id] ??= []).push(t);
    }
    return map;
  }, [txns]);

  const visibleTxns = useMemo(() => {
    let result = txns;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(t =>
        t.description.toLowerCase().includes(q) ||
        t.amount.includes(search.trim())
      );
    }
    if (appliedDateFrom) result = result.filter(t => t.transaction_date >= appliedDateFrom);
    if (appliedDateTo) result = result.filter(t => t.transaction_date <= appliedDateTo);
    if (txnTypeFilter === 'money_in') result = result.filter(t => parseFloat(t.amount) >= 0);
    else if (txnTypeFilter === 'money_out') result = result.filter(t => parseFloat(t.amount) < 0);
    else if (txnTypeFilter === 'suggested_matches' || txnTypeFilter === 'uncategorized') result = result.filter(t => t.status === 'unreviewed');
    return result;
  }, [txns, search, appliedDateFrom, appliedDateTo, txnTypeFilter]);

  if (!bizId) return <div>Pick a business.</div>;

  if (bankAccounts.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Bank Transactions</h1>
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          No bank accounts — create one in <Link to="/accounting/bank-accounts" className="text-primary underline">Bank Accounts</Link> first.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bank Transactions</h1>
        <Button asChild variant="outline"><Link to="/accounting/bank-transactions/import">Import CSV</Link></Button>
      </div>

      {/* Account cards */}
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
        {bankAccounts.map(b => {
          const selected = bankAccountId === b.id;
          const accountTxns = txnsByAccount[b.id] ?? [];
          const inBooks = accountTxns.reduce((s, t) => s + parseFloat(t.amount), 0);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setBankAccountId(b.id)}
              className={`shrink-0 w-52 rounded-lg border p-3 text-left transition-colors ${
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-card-foreground hover:border-primary/50 hover:bg-muted/40'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium truncate">
                  {b.name}{b.account_last_four ? ` - ${b.account_last_four}` : ''}
                </span>
                <CreditCard className="h-4 w-4 shrink-0 opacity-60" />
              </div>
              <div className={`text-[10px] uppercase tracking-wide font-medium mt-2 ${selected ? 'opacity-70' : 'text-muted-foreground'}`}>
                Bank Balance
              </div>
              <div className="text-sm font-semibold font-mono">—</div>
              <div className={`text-[10px] uppercase tracking-wide font-medium mt-1 ${selected ? 'opacity-70' : 'text-muted-foreground'}`}>
                In Books
              </div>
              <div className="text-sm font-semibold font-mono">
                {fmtMoney(inBooks)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Pill tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
        {STATUS_OPTIONS.map(o => {
          const active = statusFilter === o.value;
          const showCount = o.value === 'unreviewed' && active;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setStatusFilter(o.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {o.label}{showCount ? ` (${txns.length})` : ''}
            </button>
          );
        })}
      </div>

      {/* Filter / search row */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">

          {/* All dates — popover */}
          <div className="relative" ref={datePanelRef}>
            <button
              type="button"
              onClick={() => setShowDatePanel(v => !v)}
              className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm hover:bg-muted/50"
            >
              <span className="text-muted-foreground">
                {appliedDateFrom || appliedDateTo
                  ? `${isoToDisplay(appliedDateFrom)} – ${isoToDisplay(appliedDateTo)}`
                  : DATE_PRESETS.find(p => p.value === datePreset)?.label ?? 'All dates'}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>

            {showDatePanel && (
              <div className="absolute left-0 top-full mt-1 z-50 w-80 rounded-lg border bg-background shadow-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <span className="text-sm font-medium">Date</span>
                  <button
                    type="button"
                    onClick={() => setShowDatePanel(false)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm mb-3"
                  value={datePreset}
                  onChange={e => {
                    const val = e.target.value;
                    setDatePreset(val);
                    if (val !== 'custom') {
                      const range = getPresetRange(val);
                      setDateFrom(range?.from ?? '');
                      setDateTo(range?.to ?? '');
                    }
                  }}
                >
                  {DATE_PRESETS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">From (MM/DD/YYYY)</label>
                    <input
                      type="date"
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={dateFrom}
                      onChange={e => { setDateFrom(e.target.value); setDatePreset('custom'); }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">To (MM/DD/YYYY)</label>
                    <input
                      type="date"
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      value={dateTo}
                      onChange={e => { setDateTo(e.target.value); setDatePreset('custom'); }}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-emerald-700 border-emerald-600 hover:bg-emerald-50"
                    onClick={() => {
                      setDatePreset('all');
                      setDateFrom('');
                      setDateTo('');
                      setAppliedDateFrom('');
                      setAppliedDateTo('');
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="bg-emerald-700 hover:bg-emerald-800 text-white"
                    onClick={() => {
                      setAppliedDateFrom(dateFrom);
                      setAppliedDateTo(dateTo);
                      setShowDatePanel(false);
                    }}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* All transactions type filter */}
          <div className="relative">
            <select
              className="h-9 appearance-none rounded-md border bg-background pl-3 pr-8 text-sm text-muted-foreground"
              value={txnTypeFilter}
              onChange={e => setTxnTypeFilter(e.target.value)}
            >
              {TXN_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8 w-64 h-9"
              placeholder="Search by description, check number, or amount"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Export / Print */}
        <div className="flex items-center gap-1">
          <div className="relative group">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              onClick={handleExcel}
              disabled={excelBusy}
              aria-label="Export to Excel"
            >
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
          </div>
          <div className="relative group">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={handlePrint}
              aria-label="Print"
            >
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
          </div>
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {/* Transactions table */}
      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            {statusFilter === 'unreviewed' && (
              <tr className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="w-8 p-3"><input type="checkbox" className="h-3.5 w-3.5 rounded border-input cursor-pointer" aria-label="Select all" /></th>
                <th className="text-left p-3 whitespace-nowrap">Date</th>
                <th className="text-left p-3">Description</th>
                <th className="text-left p-3">Payee</th>
                <th className="text-left p-3 whitespace-nowrap">Categorize or Match</th>
                <th className="text-right p-3">Spent</th>
                <th className="text-right p-3">Received</th>
                <th className="text-left p-3">Action</th>
              </tr>
            )}
            {statusFilter === 'categorized' && (
              <tr className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="w-8 p-3"><input type="checkbox" className="h-3.5 w-3.5 rounded border-input cursor-pointer" aria-label="Select all" /></th>
                <th className="text-left p-3 whitespace-nowrap">Date</th>
                <th className="text-left p-3">Description</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-left p-3">Payee</th>
                <th className="text-left p-3 whitespace-nowrap">Added or Matched</th>
                <th className="text-left p-3">Category</th>
                <th className="text-left p-3">Rule</th>
                <th className="text-left p-3">Action</th>
              </tr>
            )}
            {statusFilter === 'excluded' && (
              <tr className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="w-8 p-3"><input type="checkbox" className="h-3.5 w-3.5 rounded border-input cursor-pointer" aria-label="Select all" /></th>
                <th className="text-left p-3 whitespace-nowrap">Date</th>
                <th className="text-left p-3">Description</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-left p-3">Action</th>
              </tr>
            )}
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && visibleTxns.length === 0 && statusFilter === 'unreviewed' && (
              <tr>
                <td colSpan={8} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                      <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                    </div>
                    <p className="text-base font-semibold">All set with this account</p>
                    <p className="text-sm text-muted-foreground max-w-xs">
                      Go to the next account to review more transactions. You can also view your updated{' '}
                      <Link to="/reports/profit-loss" className="text-primary underline">profit and loss</Link>.
                    </p>
                  </div>
                </td>
              </tr>
            )}
            {!loading && visibleTxns.length === 0 && statusFilter !== 'unreviewed' && (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No transactions match the current filter.</td></tr>
            )}
            {visibleTxns.map(t => {
              const n = parseFloat(t.amount);
              const isNegative = Number.isFinite(n) && n < 0;
              const isOpen = action?.txnId === t.id;
              const colSpanAll = statusFilter === 'unreviewed' ? 8 : statusFilter === 'excluded' ? 5 : 9;
              return (
                <Fragment key={t.id}>
                  <tr className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3">
                      <input type="checkbox" className="h-3.5 w-3.5 rounded border-input cursor-pointer" />
                    </td>
                    <td className="p-3 whitespace-nowrap">{fmtShortDate(t.transaction_date)}</td>
                    <td className="p-3 max-w-[200px] truncate">{t.description}</td>

                    {statusFilter === 'unreviewed' && (
                      <>
                        <td className="p-3 text-muted-foreground text-xs">—</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline" onClick={() => openAction(t, 'match')} disabled={busy}>Match</Button>
                            <Button size="sm" variant="outline" onClick={() => openAction(t, 'categorize')} disabled={busy}>Categorize</Button>
                            <Button size="sm" variant="ghost" onClick={() => openAction(t, 'exclude')} disabled={busy}>Exclude</Button>
                          </div>
                        </td>
                        <td className="p-3 text-right font-mono text-destructive whitespace-nowrap">
                          {isNegative ? fmtMoney(Math.abs(n)) : ''}
                        </td>
                        <td className="p-3 text-right font-mono text-emerald-700 whitespace-nowrap">
                          {!isNegative && Number.isFinite(n) ? fmtMoney(n) : ''}
                        </td>
                        <td className="p-3" />
                      </>
                    )}
                    {statusFilter === 'categorized' && (
                      <>
                        <td className={`p-3 text-right font-mono whitespace-nowrap ${isNegative ? 'text-destructive' : 'text-emerald-700'}`}>
                          {Number.isFinite(n) ? fmtMoney(Math.abs(n)) : '—'}
                        </td>
                        <td className="p-3 text-muted-foreground text-xs">—</td>
                        <td className="p-3 text-xs">
                          {t.matched_journal_entry_id ? (
                            <span className="text-muted-foreground">
                              Added to:{' '}
                              <Link to={`/journal/${t.matched_journal_entry_id}`} className="text-primary underline">
                                Journal Entry {fmtShortDate(t.transaction_date)}
                              </Link>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Added</span>
                          )}
                        </td>
                        <td className="p-3 text-muted-foreground text-xs">—</td>
                        <td className="p-3 text-muted-foreground text-xs">—</td>
                        <td className="p-3">
                          {canUnreview && !t.is_reconciled && (
                            <button type="button" onClick={() => unreview(t)} disabled={busy}
                              className="text-sm font-medium text-primary hover:underline disabled:opacity-50">
                              Undo
                            </button>
                          )}
                        </td>
                      </>
                    )}
                    {statusFilter === 'excluded' && (
                      <>
                        <td className={`p-3 text-right font-mono whitespace-nowrap ${isNegative ? 'text-destructive' : 'text-emerald-700'}`}>
                          {Number.isFinite(n) ? fmtMoney(Math.abs(n)) : '—'}
                        </td>
                        <td className="p-3">
                          {canUnreview && !t.is_reconciled && (
                            <button type="button" onClick={() => unreview(t)} disabled={busy}
                              className="text-sm font-medium text-primary hover:underline disabled:opacity-50">
                              Undo
                            </button>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                  {isOpen && action && (
                    <tr className="bg-muted/20">
                      <td colSpan={colSpanAll} className="p-4">
                        {action.mode === 'match' && (
                          <form className="grid grid-cols-12 gap-2 items-end" onSubmit={submitMatch}>
                            <div className="col-span-9">
                              <Label>Match to journal entry</Label>
                              <select
                                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                                value={action.journal_entry_id}
                                onChange={e => setAction(a => (a ? { ...a, journal_entry_id: e.target.value } : a))}
                                required
                              >
                                <option value="">Select JE…</option>
                                {journalEntries.map(je => (
                                  <option key={je.id} value={je.id}>
                                    {je.entry_date} — {je.status} — {je.memo ?? je.reference ?? je.id.slice(0, 8)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="col-span-3 flex gap-2">
                              <Button type="submit" size="sm" disabled={busy || !action.journal_entry_id}>Submit</Button>
                              <Button type="button" size="sm" variant="ghost" onClick={closeAction} disabled={busy}>Cancel</Button>
                            </div>
                          </form>
                        )}
                        {action.mode === 'categorize' && (
                          <form className="grid grid-cols-12 gap-2 items-end" onSubmit={submitCategorize}>
                            <div className="col-span-6">
                              <Label>Offset account</Label>
                              <select
                                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                                value={action.offset_account_id}
                                onChange={e => setAction(a => (a ? { ...a, offset_account_id: e.target.value } : a))}
                                required
                              >
                                <option value="">Select account…</option>
                                {Object.keys(groupedAccounts).sort().map(type => {
                                  const bucket = groupedAccounts[type] ?? [];
                                  return (
                                    <optgroup key={type} label={type}>
                                      {bucket.map(a => (
                                        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                                      ))}
                                    </optgroup>
                                  );
                                })}
                              </select>
                            </div>
                            <div className="col-span-4">
                              <Label>Memo (optional)</Label>
                              <Input
                                value={action.memo}
                                onChange={e => setAction(a => (a ? { ...a, memo: e.target.value } : a))}
                                placeholder="JE memo override"
                              />
                            </div>
                            <div className="col-span-2 flex gap-2">
                              <Button type="submit" size="sm" disabled={busy || !action.offset_account_id}>Submit</Button>
                              <Button type="button" size="sm" variant="ghost" onClick={closeAction} disabled={busy}>Cancel</Button>
                            </div>
                          </form>
                        )}
                        {action.mode === 'exclude' && (
                          <form className="grid grid-cols-12 gap-2 items-end" onSubmit={submitExclude}>
                            <div className="col-span-9">
                              <Label>Reason</Label>
                              <Input
                                value={action.excluded_reason}
                                onChange={e => setAction(a => (a ? { ...a, excluded_reason: e.target.value } : a))}
                                placeholder="Transfer between own accounts, test charge, etc."
                                required
                              />
                            </div>
                            <div className="col-span-3 flex gap-2">
                              <Button type="submit" size="sm" disabled={busy || !action.excluded_reason.trim()}>Submit</Button>
                              <Button type="button" size="sm" variant="ghost" onClick={closeAction} disabled={busy}>Cancel</Button>
                            </div>
                          </form>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
