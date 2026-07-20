import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { fmtMoney } from '@/lib/money';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';

type RegisterAccount = { id: string; code: string; name: string; account_type: string; is_active: boolean };
type AccountOption = { id: string; code: string; name: string; is_active: boolean };
type RegisterRow = {
  journal_entry_id: string;
  line_id: string;
  entry_date: string;
  reference: string | null;
  source_type: string;
  memo: string | null;
  counter_account: string;
  debit: string;
  credit: string;
  balance: string;
  is_voided: boolean;
};

// Legacy register payload served by API deploys that predate the unified
// endpoint ({ account, entries, balance } — newest first, raw-sign balance).
type LegacyEntry = {
  id: string;
  journal_entry_id: string;
  entry_date: string;
  reference: string | null;
  source_type: string;
  entry_memo: string | null;
  line_memo: string | null;
  debit: string;
  credit: string;
  counter_account: string;
  running_balance: string;
  status: string;
};

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Journal Entry',
  invoice: 'Invoice',
  payment: 'Payment',
  bill: 'Bill',
  bill_payment: 'Bill Payment',
  expense: 'Expense',
  vendor_credit: 'Vendor Credit',
  transfer: 'Transfer',
  bank_import: 'Bank Import',
  reversal: 'Reversal',
  adjustment: 'Adjustment',
  payroll: 'Payroll',
  opening_balance: 'Opening Balance',
};

// UTC-pinned so the label matches the ISO date (see lib/dates.ts rationale).
function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

export default function AccountRegisterPage() {
  const [bizId] = useActiveBusinessId();
  const { accountId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [account, setAccount] = useState<RegisterAccount | null>(null);
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [endingBalance, setEndingBalance] = useState<string>('0');
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const listPath = location.pathname.startsWith('/settings') ? '/settings/coa' : '/setup/coa';
  const registerBase = location.pathname.startsWith('/settings') ? '/settings/coa'
    : location.pathname.startsWith('/setup') ? '/setup/coa'
    : '/coa'; // legacy prod path

  // Account switcher: jump between registers without going back to the list.
  useEffect(() => {
    if (!bizId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get(`/businesses/${bizId}/coa?include_inactive=true`);
        if (!cancelled) setAccountOptions(r.data.accounts as AccountOption[]);
      } catch { /* switcher is optional; the register itself still loads */ }
    })();
    return () => { cancelled = true; };
  }, [bizId]);

  useEffect(() => {
    if (!bizId || !accountId) return;
    let cancelled = false;
    (async () => {
      setState('loading');
      try {
        const r = await api.get(`/businesses/${bizId}/coa/${accountId}/register`);
        if (cancelled) return;
        setAccount(r.data.account);
        if (Array.isArray(r.data.rows)) {
          // Unified shape: ascending rows, natural-sign running balance.
          setRows(r.data.rows as RegisterRow[]);
          setEndingBalance(String(r.data.ending_balance ?? '0'));
        } else if (Array.isArray(r.data.entries)) {
          // Legacy shape (older API deploy): newest-first entries with raw
          // debit-minus-credit running balance. Adapt so the page still works
          // until the API is redeployed.
          const mapped: RegisterRow[] = (r.data.entries as LegacyEntry[]).map(e => ({
            journal_entry_id: e.journal_entry_id,
            line_id: e.id,
            entry_date: e.entry_date,
            reference: e.reference,
            source_type: e.source_type,
            memo: e.line_memo ?? e.entry_memo,
            counter_account: e.counter_account ?? '—',
            debit: e.debit,
            credit: e.credit,
            balance: e.running_balance,
            is_voided: e.status === 'voided',
          })).reverse();
          setRows(mapped);
          setEndingBalance(String(r.data.balance ?? '0'));
        } else {
          setRows([]);
          setEndingBalance('0');
        }
        setState('ready');
      } catch (e: unknown) {
        if (cancelled) return;
        const status = (e as { response?: { status?: number } } | undefined)?.response?.status;
        setState(status === 404 ? 'unavailable' : 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [bizId, accountId]);

  // Filters run over the ascending rows; each row keeps its true running
  // balance even when neighbors are filtered out.
  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      if (dateFrom && r.entry_date < dateFrom) return false;
      if (dateTo && r.entry_date > dateTo) return false;
      if (needle) {
        const hay = `${r.memo ?? ''} ${r.reference ?? ''} ${r.counter_account} ${sourceLabel(r.source_type)}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, dateFrom, dateTo]);

  // Payment/Deposit split for debit-normal (bank-like) accounts; for
  // credit-normal accounts the movement columns read Decrease/Increase.
  const debitNormal = !account || account.account_type === 'asset' || account.account_type === 'expense';
  const decreaseOf = (r: RegisterRow) => (debitNormal ? r.credit : r.debit);
  const increaseOf = (r: RegisterRow) => (debitNormal ? r.debit : r.credit);
  const moneyOrBlank = (v: string) => (Number(v) === 0 ? '' : fmtMoney(v));

  const columns: Column<RegisterRow>[] = [
    { key: 'entry_date', header: 'Date', render: r => <span className="whitespace-nowrap font-mono text-sm">{fmtShortDate(r.entry_date)}</span> },
    { key: 'reference', header: 'Ref no.', render: r => <span className="font-mono text-xs text-muted-foreground">{r.reference ?? ''}</span> },
    {
      key: 'source_type', header: 'Type',
      exportValue: r => sourceLabel(r.source_type),
      render: r => (
        <button
          type="button"
          className="text-primary hover:underline"
          title="Open journal entry"
          onClick={() => navigate(`/journal/${r.journal_entry_id}`)}
        >
          {sourceLabel(r.source_type)}
        </button>
      ),
    },
    { key: 'counter_account', header: 'Account', render: r => <span>{r.counter_account}</span> },
    {
      key: 'memo', header: 'Memo',
      render: r => (
        <span className={`block max-w-[16rem] truncate ${r.is_voided ? 'text-muted-foreground line-through' : 'text-muted-foreground'}`} title={r.memo ?? undefined}>
          {r.memo ?? ''}
          {r.is_voided && <span className="ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground no-underline">Voided</span>}
        </span>
      ),
    },
    {
      key: 'decrease', header: debitNormal ? 'Payment' : 'Decrease', align: 'right',
      exportValue: r => moneyOrBlank(decreaseOf(r)),
      render: r => (Number(decreaseOf(r)) !== 0
        ? <span className="tabular-nums font-mono text-destructive">{fmtMoney(decreaseOf(r))}</span>
        : <span className="text-muted-foreground/30">—</span>),
    },
    {
      key: 'increase', header: debitNormal ? 'Deposit' : 'Increase', align: 'right',
      exportValue: r => moneyOrBlank(increaseOf(r)),
      render: r => (Number(increaseOf(r)) !== 0
        ? <span className="tabular-nums font-mono text-emerald-600">{fmtMoney(increaseOf(r))}</span>
        : <span className="text-muted-foreground/30">—</span>),
    },
    { key: 'balance', header: 'Balance', align: 'right', exportValue: r => fmtMoney(r.balance), render: r => <span className="tabular-nums font-mono font-medium whitespace-nowrap">{fmtMoney(r.balance)}</span> },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  const isBalanceSheet = account && ['asset', 'liability', 'equity'].includes(account.account_type);

  return (
    <div className="space-y-4">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        onClick={() => navigate(listPath)}
      >
        <ArrowLeft className="h-4 w-4" /> Back to Chart of Accounts
      </button>

      {/* Header: account identity + ending balance */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">{account ? account.name : 'Account register'}</h1>
          {account && (
            <span className="rounded-md border bg-muted/30 px-3 py-1.5 text-sm font-medium">
              <span className="font-mono">{account.code}</span>
              <span className="text-muted-foreground ml-1.5 capitalize">· {account.account_type}</span>
            </span>
          )}
        </div>
        {state === 'ready' && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Ending balance{isBalanceSheet !== null && (
                <span className="normal-case tracking-normal"> · {isBalanceSheet ? 'Balance Sheet' : 'Income Statement'} account</span>
              )}
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums">{fmtMoney(endingBalance)}</div>
          </div>
        )}
      </div>

      {/* Toolbar: account switcher + register filters */}
      <div className="flex flex-wrap items-end gap-3">
        {accountOptions.length > 0 && (
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Account</div>
            <select
              className="h-9 max-w-[22rem] rounded-md border bg-background px-3 text-sm"
              value={accountId ?? ''}
              onChange={e => { if (e.target.value) navigate(`${registerBase}/${e.target.value}/register`); }}
            >
              {accountOptions.map(a => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}{a.is_active ? '' : ' (inactive)'}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <div className="mb-1 text-xs text-muted-foreground">From</div>
          <Input type="date" className="h-9 w-40" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">To</div>
          <Input type="date" className="h-9 w-40" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <div className="min-w-[14rem] flex-1">
          <div className="mb-1 text-xs text-muted-foreground">Search</div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 h-9" placeholder="Filter by memo, ref no., account, or type" value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>
        {(q || dateFrom || dateTo) && (
          <Button variant="outline" className="h-9" onClick={() => { setQ(''); setDateFrom(''); setDateTo(''); }}>
            Clear filters
          </Button>
        )}
      </div>

      {state === 'loading' && <p className="text-sm text-muted-foreground">Loading register…</p>}

      {state === 'unavailable' && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          The account register isn't available on this API deployment yet. Deploy the latest API and reload this page.
        </CardContent></Card>
      )}

      {state === 'error' && (
        <Card><CardContent className="p-6 flex items-center justify-between gap-4 text-sm">
          <span className="text-destructive">Couldn't load the register.</span>
          <Button variant="outline" onClick={() => navigate(0)}>Retry</Button>
        </CardContent></Card>
      )}

      {state === 'ready' && (
        <Card><CardContent className="p-0">
          <DataTable
            // Newest first, like the QBO register; balances are the running
            // balance at each row (computed oldest-to-newest server side).
            rows={[...filteredRows].reverse()}
            getRowId={r => r.line_id}
            columns={columns}
            selectable={false}
            pagination={{ pageSize: 75 }}
            {...(account ? { downloadable: { filename: `register-${account.code}`, title: `Register — ${account.name}` } } : {})}
            emptyMessage={rows.length > 0
              ? <EmptyState title="No matching transactions" hint="Adjust or clear the filters above." />
              : <EmptyState title="No transactions yet" hint="Posted journal entries that touch this account will appear here." />}
          />
        </CardContent></Card>
      )}
    </div>
  );
}
