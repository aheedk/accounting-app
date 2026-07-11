import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import type { Role } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
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
  { value: 'matched', label: 'Matched' },
  { value: 'categorized', label: 'Categorized' },
  { value: 'excluded', label: 'Excluded' },
  { value: 'all', label: 'All' },
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
      return <span className={`${base} bg-amber-100 text-amber-800`}>unreviewed</span>;
    case 'matched':
      return <span className={`${base} bg-blue-100 text-blue-800`}>matched</span>;
    case 'categorized':
      return <span className={`${base} bg-emerald-100 text-emerald-800`}>categorized</span>;
    case 'excluded':
      return <span className={`${base} bg-muted text-muted-foreground`}>excluded</span>;
    default:
      return <span className={base}>{status}</span>;
  }
}

function defaultOffsetType(amount: string): 'revenue' | 'expense' {
  const n = parseFloat(amount);
  if (Number.isFinite(n) && n >= 0) return 'revenue';
  return 'expense';
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

  // Load bank accounts once per biz.
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

  // Load JE list and CoA once per biz (used by action forms).
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

  // Groupings for offset account dropdown (grouped by account_type).
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bank Transactions</h1>
        <Button asChild variant="outline"><Link to="/accounting/bank-transactions/import">Import CSV</Link></Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Bank account</div>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={bankAccountId}
            onChange={e => setBankAccountId(e.target.value)}
          >
            {bankAccounts.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}{b.account_last_four ? ` ••${b.account_last_four}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {STATUS_OPTIONS.map(o => {
          const active = statusFilter === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setStatusFilter(o.value)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Description</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {txns.length === 0 && (
              <tr>
                <td colSpan={5}>
                  {loading ? (
                    <div className="p-6 text-center text-muted-foreground">Loading…</div>
                  ) : (
                    <EmptyState
                      title="No transactions here"
                      hint="Import a bank CSV to fill this inbox, or adjust the status filter above."
                      actionLabel="Import transactions"
                      actionTo="/accounting/bank-transactions/import"
                    />
                  )}
                </td>
              </tr>
            )}
            {txns.map(t => {
              const n = parseFloat(t.amount);
              const positive = Number.isFinite(n) && n >= 0;
              const isOpen = action?.txnId === t.id;
              return (
                <Fragment key={t.id}>
                  <tr className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 whitespace-nowrap">{fmtShortDate(t.transaction_date)}</td>
                    <td className="p-3">{t.description}</td>
                    <td className={`p-3 text-right font-mono ${positive ? 'text-emerald-700' : 'text-destructive'}`}>
                      {fmtMoney(t.amount)}
                    </td>
                    <td className="p-3">{statusBadge(t.status)}</td>
                    <td className="p-3">
                      {t.status === 'unreviewed' && (
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="outline" onClick={() => openAction(t, 'match')} disabled={busy}>Match</Button>
                          <Button size="sm" variant="outline" onClick={() => openAction(t, 'categorize')} disabled={busy}>Categorize</Button>
                          <Button size="sm" variant="ghost" onClick={() => openAction(t, 'exclude')} disabled={busy}>Exclude</Button>
                        </div>
                      )}
                      {t.status !== 'unreviewed' && (
                        <div className="flex items-center gap-2">
                          {t.matched_journal_entry_id && (
                            <Link to={`/journal/${t.matched_journal_entry_id}`} className="text-primary underline font-mono text-xs">
                              JE {t.matched_journal_entry_id.slice(0, 8)}
                            </Link>
                          )}
                          {t.status === 'excluded' && t.excluded_reason && (
                            <span className="text-xs text-muted-foreground">reason: {t.excluded_reason}</span>
                          )}
                          {canUnreview && !t.is_reconciled && (
                            <Button size="sm" variant="ghost" onClick={() => unreview(t)} disabled={busy}>Unreview</Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {isOpen && action && (
                    <tr className="bg-muted/20">
                      <td colSpan={5} className="p-4">
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
