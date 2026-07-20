import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { fmtMoney } from '@/lib/money';

type Account = { id: string; code: string; name: string; account_type: string; is_active: boolean };

type RegisterEntry = {
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

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

export default function AccountRegisterPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [entries, setEntries] = useState<RegisterEntry[]>([]);
  const [balance, setBalance] = useState('0');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bizId || !accountId) return;
    setLoading(true);
    api.get(`/businesses/${bizId}/coa/${accountId}/register`)
      .then(r => {
        setAccount(r.data.account);
        setEntries(r.data.entries);
        setBalance(r.data.balance);
      })
      .finally(() => setLoading(false));
  }, [bizId, accountId]);

  if (!bizId) return <div>Pick a business.</div>;

  const isBalanceSheet = account && ['asset', 'liability', 'equity'].includes(account.account_type);
  const registerLabel = account
    ? (account.account_type === 'asset' ? 'Bank Register' : account.account_type.charAt(0).toUpperCase() + account.account_type.slice(1) + ' Register')
    : 'Register';

  return (
    <div className="space-y-0 -mx-6 -my-6">
      {/* ── Top breadcrumb bar ── */}
      <div className="border-b px-6 py-3 bg-background">
        <button
          type="button"
          onClick={() => nav(-1)}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Chart of Accounts
        </button>
      </div>

      {/* ── Header ── */}
      <div className="border-b px-6 py-4 bg-background flex items-start justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-xl font-semibold">{registerLabel}</h1>
          {account && (
            <div className="flex items-center gap-2">
              <div className="rounded-md border bg-muted/30 px-3 py-1.5 text-sm font-medium">
                {account.name}
                {account.code && <span className="text-muted-foreground ml-1.5">· {account.code}</span>}
              </div>
            </div>
          )}
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Balance</span>
            {' '}
            <span className="font-mono font-semibold">{fmtMoney(balance)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/accounting/bank-transactions"
            className="inline-flex h-9 items-center rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            Bank transactions
          </Link>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md bg-emerald-600 text-white px-4 text-sm font-semibold hover:bg-emerald-700 transition-colors"
          >
            Reconcile
          </button>
        </div>
      </div>

      {/* ── Ending balance banner ── */}
      <div className="border-b px-6 py-3 bg-muted/10 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {isBalanceSheet ? 'Balance Sheet' : 'Income Statement'} account
          {account && <span className="ml-1 capitalize">· {account.account_type}</span>}
        </span>
        <div className="text-right">
          <div className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Ending Balance</div>
          <div className="text-2xl font-bold font-mono tabular-nums">{fmtMoney(balance)}</div>
        </div>
      </div>

      {/* ── Table ── */}
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
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={8} className="py-16 text-center">
                  <p className="text-base font-medium">No transactions yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Transactions posted to this account will appear here.</p>
                </td>
              </tr>
            )}
            {entries.map(e => {
              const payment = parseFloat(e.credit) > 0 ? e.credit : null;
              const deposit = parseFloat(e.debit) > 0 ? e.debit : null;
              const memo = e.line_memo ?? e.entry_memo;
              return (
                <tr key={e.id} className="border-b hover:bg-muted/20 group">
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-sm">{fmtDate(e.entry_date)}</td>
                  <td className="px-4 py-3">
                    {e.reference && <div className="text-xs text-muted-foreground font-mono">{e.reference}</div>}
                    <div className="text-sm">{SOURCE_LABEL[e.source_type] ?? e.source_type}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm">{e.counter_account}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{memo ?? ''}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {payment ? <span className="text-destructive">{fmtMoney(payment)}</span> : <span className="text-muted-foreground/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {deposit ? <span className="text-emerald-600">{fmtMoney(deposit)}</span> : <span className="text-muted-foreground/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-muted-foreground">
                    {e.status === 'posted' ? 'C' : ''}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium whitespace-nowrap">
                    {fmtMoney(e.running_balance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && entries.length > 0 && (
        <div className="border-t px-6 py-3 text-right text-sm text-muted-foreground">
          {entries.length} transaction{entries.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}
