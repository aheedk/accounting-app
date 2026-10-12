import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { fmtMoney } from '@/lib/money';
import { AppSelect } from '@/components/ui/select';
import { pickErr } from '@/lib/apiErrors';

type ReconcilableAccount = { id: string; code: string; name: string; category: string };

type RegisterLine = {
  journal_entry_id: string;
  line_id: string;
  entry_date: string;
  transaction_label: string;
  num: string | null;
  name: string | null;
  transaction_path: string;
  memo: string | null;
  split_account: string | null;
  status: 'posted' | 'voided';
  debit: string;
  credit: string;
  running_balance: string;
  is_reconciled: boolean;
};

type RegisterAccount = { account_id: string; account_code: string; account_name: string; ending_balance: string };

const PAGE_SIZE = 50;

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

export default function AccountRegisterPage() {
  const params = useParams<{ accountId?: string }>();
  const [searchParams] = useSearchParams();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();

  const [reconcilableAccounts, setReconcilableAccounts] = useState<ReconcilableAccount[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [account, setAccount] = useState<RegisterAccount | null>(null);
  const [lines, setLines] = useState<RegisterLine[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // The URL :accountId param (the old /coa/:id/register links) or ?accountId=
  // (the new /accounting/register?accountId= links) wins on first load; after
  // that the page's own dropdown drives it.
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/bank-rec/accounts`).then(r => {
      const list: ReconcilableAccount[] = r.data.accounts;
      setReconcilableAccounts(list);
      setAccountId(prev => {
        if (prev && list.some(a => a.id === prev)) return prev;
        const requested = params.accountId ?? searchParams.get('accountId');
        if (requested && list.some(a => a.id === requested)) return requested;
        return list[0]?.id ?? '';
      });
    }).catch((e: unknown) => setErr(pickErr(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the business changes
  }, [bizId]);

  useEffect(() => {
    if (!bizId || !accountId) return;
    setLoading(true);
    setErr(null);
    setPage(0);
    api.get(`/businesses/${bizId}/reports/register/${accountId}`)
      .then(r => {
        setAccount(r.data.account);
        setLines(r.data.lines ?? []);
      })
      .catch((e: unknown) => { setErr(pickErr(e)); setLines([]); setAccount(null); })
      .finally(() => setLoading(false));
  }, [bizId, accountId]);

  // Newest first, like QBO's register.
  const ordered = useMemo(() => [...lines].reverse(), [lines]);
  const totalPages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const pageRows = ordered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = ordered.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(ordered.length, page * PAGE_SIZE + PAGE_SIZE);

  if (!bizId) return <div>Pick a business.</div>;

  function Pagination() {
    return (
      <div className="flex items-center justify-end gap-2 px-6 py-2 text-xs text-muted-foreground">
        <span>Go to:</span>
        <span className="font-medium text-foreground">{page + 1} of {totalPages}</span>
        <button type="button" className="underline disabled:opacity-40 disabled:no-underline" disabled={page === 0} onClick={() => setPage(0)}>First</button>
        <button type="button" className="underline disabled:opacity-40 disabled:no-underline" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</button>
        <span>{rangeStart}-{rangeEnd} of {ordered.length}</span>
        <button type="button" className="underline disabled:opacity-40 disabled:no-underline" disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>Next</button>
        <button type="button" className="underline disabled:opacity-40 disabled:no-underline" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>Last</button>
      </div>
    );
  }

  return (
    <div className="space-y-0 -mx-6 -my-6">
      <div className="border-b px-6 py-3 bg-background">
        <button
          type="button"
          onClick={() => nav('/settings/coa')}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Chart of Accounts
        </button>
      </div>

      <div className="border-b px-6 py-4 bg-background flex items-start justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-xl font-semibold">Bank Register</h1>
          <div className="w-64">
            <AppSelect
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
            >
              {reconcilableAccounts.map(a => (
                <option key={a.id} value={a.id} data-hint={a.category}>{a.code} {a.name}</option>
              ))}
            </AppSelect>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Ending Balance</div>
            <div className="text-xl font-bold font-mono tabular-nums">{account ? fmtMoney(account.ending_balance) : '0.00'}</div>
          </div>
          <button
            type="button"
            onClick={() => nav(`/accounting/reconcile?accountId=${accountId}`)}
            className="inline-flex h-9 items-center rounded-md bg-emerald-600 text-white px-4 text-sm font-semibold hover:bg-emerald-700 transition-colors"
          >
            Reconcile
          </button>
        </div>
      </div>

      {err && <div className="mx-6 mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</div>}

      <Pagination />

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Ref No.<br />Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Payee<br />Account</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Memo</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Payment</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Deposit</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide w-8">✓</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Balance</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && pageRows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-16 text-center">
                  <p className="text-base font-medium">No transactions yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Transactions posted to this account will appear here.</p>
                </td>
              </tr>
            )}
            {pageRows.map(l => {
              const payment = parseFloat(l.credit) > parseFloat(l.debit) ? l.credit : null;
              const deposit = parseFloat(l.debit) > parseFloat(l.credit) ? l.debit : null;
              return (
                <tr key={l.line_id} className="border-b hover:bg-muted/20 cursor-pointer" onClick={() => nav(l.transaction_path)}>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-sm">{fmtDate(l.entry_date)}</td>
                  <td className="px-4 py-3">
                    {l.num && <div className="text-xs text-muted-foreground font-mono">{l.num}</div>}
                    <div className="text-sm">{l.transaction_label}</div>
                  </td>
                  <td className="px-4 py-3">
                    {l.name && <div className="text-sm">{l.name}</div>}
                    <div className="text-xs text-muted-foreground">{l.split_account ?? '—'}</div>
                  </td>
                  <td className={`px-4 py-3 text-muted-foreground max-w-[200px] truncate ${l.status === 'voided' ? 'line-through' : ''}`}>
                    {l.memo ?? ''}
                    {l.status === 'voided' && <span className="ml-2 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground no-underline">Voided</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {payment ? <span className="text-destructive">{fmtMoney(payment)}</span> : <span className="text-muted-foreground/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {deposit ? <span className="text-emerald-600">{fmtMoney(deposit)}</span> : <span className="text-muted-foreground/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">
                    {l.is_reconciled ? 'R' : ''}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium whitespace-nowrap">
                    {fmtMoney(l.running_balance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination />

      <div className="relative border-t px-6 py-3">
        <button
          type="button"
          onClick={() => setAddOpen(o => !o)}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Add check <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {addOpen && (
          <div className="absolute bottom-full left-6 mb-1 w-40 rounded-md border bg-white dark:bg-zinc-900 shadow-xl">
            <Link to={`/accounting/checks/new?accountId=${accountId}`} className="block px-3 py-2 text-sm hover:bg-accent" onClick={() => setAddOpen(false)}>Check</Link>
            <Link to={`/accounting/deposits/new?accountId=${accountId}`} className="block px-3 py-2 text-sm hover:bg-accent" onClick={() => setAddOpen(false)}>Deposit</Link>
            <Link to={`/accounting/expenses/new?accountId=${accountId}`} className="block px-3 py-2 text-sm hover:bg-accent" onClick={() => setAddOpen(false)}>Expense</Link>
          </div>
        )}
      </div>
    </div>
  );
}
