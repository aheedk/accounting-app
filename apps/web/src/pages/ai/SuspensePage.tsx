import { useCallback, useEffect, useMemo, useState } from 'react';
import { hideUnless, useCan } from '@/lib/roleAccess';
import { Link } from 'react-router-dom';
import { HelpCircle, CheckCircle } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { fmtMoney } from '@/lib/money';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { Input } from '@/components/ui/input';

type SuspenseItem = {
  journal_entry_id: string;
  entry_date: string;
  label: string;
  num: string | null;
  payee: string | null;
  description: string | null;
  amount: string;
  direction: 'out' | 'in';
  bank_account_name: string | null;
  path: string;
  age_days: number;
};

type Account = { id: string; code: string; name: string; account_type: string; is_active?: boolean };

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${Number(m)}/${Number(d)}/${y}` : iso;
}

/**
 * Everything the AI parked in Suspense because it could not tell what it was.
 * Spec: docs/specs/2026-10-04-suspense-account-design.md
 */
export default function SuspensePage() {
  // What this login may do here; anything it may not is left off the page.
  const can = useCan();
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<SuspenseItem[]>([]);
  const [suspenseId, setSuspenseId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    try {
      const [suspense, coa] = await Promise.all([
        api.get<{ account_id: string | null; items: SuspenseItem[] }>(`/businesses/${bizId}/suspense`),
        api.get<{ accounts: Account[] }>(`/businesses/${bizId}/coa`),
      ]);
      setItems(suspense.data.items);
      setSuspenseId(suspense.data.account_id);
      setAccounts(coa.data.accounts ?? []);
      setError(null);
    } catch (e: unknown) {
      setError(pickErr(e));
    } finally {
      setLoading(false);
    }
  }, [bizId]);

  useEffect(() => { void load(); }, [load]);

  const choices = useMemo(
    () => accounts.filter(a => a.id !== suspenseId && a.is_active !== false),
    [accounts, suspenseId],
  );

  async function reclassify(item: SuspenseItem) {
    const accountId = choice[item.journal_entry_id];
    if (!bizId || !accountId) return;
    setBusyId(item.journal_entry_id);
    setError(null);
    try {
      await api.post(`/businesses/${bizId}/suspense/${item.journal_entry_id}/reclassify`, {
        account_id: accountId,
        remember: remember[item.journal_entry_id] === true,
      });
      const account = accounts.find(a => a.id === accountId);
      setNotice(`${fmtMoney(item.amount)} ${item.payee ? `(${item.payee}) ` : ''}moved to ${account ? `${account.code} ${account.name}` : 'the chosen account'}.`);
      await load();
    } catch (e: unknown) {
      setError(pickErr(e));
    } finally {
      setBusyId(null);
    }
  }

  const q = filter.trim().toLowerCase();
  const visible = q
    ? items.filter(i => [i.payee, i.description, i.label, i.bank_account_name].some(v => v?.toLowerCase().includes(q)))
    : items;
  const total = items.reduce((sum, i) => sum + (i.direction === 'out' ? Number(i.amount) : -Number(i.amount)), 0);

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <HelpCircle className="h-5 w-5 text-primary" />
            Suspense
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Transactions the AI could not categorize. They are in the books so balances stay right, waiting here
            until you know what they were. Suspense should be empty before a period is closed.
          </p>
        </div>
        <Input placeholder="Filter by payee or description…" value={filter} onChange={e => setFilter(e.target.value)} className="w-64" />
      </div>

      {!loading && items.length > 0 && (
        <div className="flex flex-wrap gap-6 rounded-md border bg-muted/20 px-4 py-3 text-sm">
          <div><span className="text-muted-foreground">Waiting: </span><span className="font-semibold">{items.length}</span></div>
          <div><span className="text-muted-foreground">Suspense balance: </span><span className="font-mono font-semibold">{fmtMoney(total.toFixed(2))}</span></div>
          <div><span className="text-muted-foreground">Oldest: </span><span className="font-semibold">{Math.max(...items.map(i => i.age_days))} days</span></div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}
      {notice && !error && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{notice}</div>
      )}

      {loading ? (
        <div className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-md border px-4 py-12 text-center">
          <CheckCircle className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
          <p className="font-medium">{items.length === 0 ? 'Suspense is clear' : 'Nothing matches that filter'}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {items.length === 0
              ? 'When the AI cannot tell what a transaction is, it lands here instead of being guessed.'
              : 'Clear the filter to see everything waiting.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 text-left">Date</th>
                <th className="px-3 py-2.5 text-left">Transaction</th>
                <th className="px-3 py-2.5 text-left">Payee / description</th>
                <th className="px-3 py-2.5 text-left">Account</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
                <th className="min-w-[320px] px-3 py-2.5 text-left">Move to</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(item => (
                <tr key={item.journal_entry_id} className="border-b align-top last:border-b-0 hover:bg-muted/20">
                  <td className="whitespace-nowrap px-3 py-2">
                    {fmtDate(item.entry_date)}
                    {item.age_days > 30 && <div className="text-[11px] text-amber-700">{item.age_days} days</div>}
                  </td>
                  <td className="px-3 py-2">
                    <Link to={item.path} className="text-primary hover:underline">{item.label}{item.num ? ` ${item.num}` : ''}</Link>
                  </td>
                  <td className="max-w-[320px] px-3 py-2">
                    {item.payee && <div className="font-medium">{item.payee}</div>}
                    {item.description && <div className="truncate text-xs text-muted-foreground" title={item.description}>{item.description}</div>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{item.bank_account_name ?? '—'}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-mono ${item.direction === 'in' ? 'text-emerald-700' : ''}`}>
                    {item.direction === 'in' ? '+' : '-'}{fmtMoney(item.amount)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <AccountSelect
                        accounts={choices}
                        value={choice[item.journal_entry_id] ?? ''}
                        onChange={id => setChoice(prev => ({ ...prev, [item.journal_entry_id]: id }))}
                        placeholder="Pick the right account…"
                        ariaLabel="Move to account"
                        className="flex-1"
                      />
                      <button
                        type="button"
                        {...hideUnless(can.accountant)} onClick={() => { void reclassify(item); }}
                        disabled={!choice[item.journal_entry_id] || busyId === item.journal_entry_id}
                        className="inline-flex h-9 shrink-0 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {busyId === item.journal_entry_id ? 'Moving…' : 'Reclassify'}
                      </button>
                    </div>
                    <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={remember[item.journal_entry_id] === true}
                        onChange={e => setRemember(prev => ({ ...prev, [item.journal_entry_id]: e.target.checked }))}
                      />
                      Remember for this payee next time
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
