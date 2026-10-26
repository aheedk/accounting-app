import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, FileSearch } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney, fmtSigned } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';
import { chatActionRoute, statementLineToCreateDraft } from '@/lib/chatActionMappers';
import type { ChatDraftState } from '@/components/chat/ChatPanel';
import { AppSelect } from '../../components/ui/select';
import { ReconcileNav } from './ReconcileNav';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';

type ItemType = 'deposit' | 'expense' | 'check' | 'journal_entry' | 'service_charge' | 'interest';

type WorksheetItem = {
  transaction_type: ItemType;
  transaction_id: string;
  transaction_date: string;
  type_label: string;
  ref_no: string | null;
  name: string | null;
  description: string | null;
  amount: string;
  is_cleared: boolean;
  auto_matched: boolean;
  transaction_path: string;
};

type Summary = {
  statement_beginning_balance: string;
  statement_ending_balance: string;
  cleared_balance: string;
  difference: string;
  cleared_count: number;
  total_count: number;
  auto_matched_count: number;
};

type Worksheet = {
  reconciliation: { id: string; account_id: string; status: string; statement_ending_date: string };
  account: { id: string; name: string };
  category: string;
  items: WorksheetItem[];
  summary: Summary;
};

type StatementMatchLine = {
  lineIndex: number;
  date: string;
  description: string;
  payeeName: string | null;
  amount: string;
  checkNumber: string | null;
  matched: {
    transaction_type: ItemType;
    transaction_id: string;
    transaction_date: string;
    name: string | null;
    description: string | null;
    amount: string;
    is_cleared: boolean;
  } | null;
  reason: 'exact_reference' | 'amount_and_date' | 'fuzzy_description' | null;
  confidence: number | null;
};

type StatementMatch = {
  statementId: string;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  lines: StatementMatchLine[];
};

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function ReconcileWorksheetPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [bizId] = useActiveBusinessId();

  const [data, setData] = useState<Worksheet | null>(null);
  const [cleared, setCleared] = useState<Map<string, boolean>>(new Map());
  const [statementMatch, setStatementMatch] = useState<StatementMatch | null>(null);
  const [matchTab, setMatchTab] = useState<'matched' | 'unmatched_statement' | 'unmatched_book'>('matched');
  const [findMatchFor, setFindMatchFor] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'deposits' | 'payments'>('all');
  const [search, setSearch] = useState('');
  const [finishWarning, setFinishWarning] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const key = (i: { transaction_type: ItemType; transaction_id: string }) => `${i.transaction_type}:${i.transaction_id}`;

  const load = useCallback(() => {
    if (!bizId || !id) return;
    setErr(null);
    api.get(`/businesses/${bizId}/bank-rec/${id}/worksheet`)
      .then(r => {
        const w: Worksheet = r.data;
        setData(w);
        setCleared(new Map(w.items.map(i => [key(i), i.is_cleared])));
      })
      .catch((e: unknown) => setErr(pickErr(e)));
    api.get<{ match: StatementMatch | null }>(`/businesses/${bizId}/bank-rec/${id}/statement-match`)
      .then(r => setStatementMatch(r.data.match))
      .catch(() => setStatementMatch(null));
  }, [bizId, id]);

  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const visible = useMemo(() => {
    let out = items;
    if (typeFilter === 'deposits') out = out.filter(i => parseFloat(i.amount) >= 0);
    if (typeFilter === 'payments') out = out.filter(i => parseFloat(i.amount) < 0);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(i =>
        (i.name ?? '').toLowerCase().includes(q)
        || (i.description ?? '').toLowerCase().includes(q)
        || (i.ref_no ?? '').toLowerCase().includes(q)
        || i.amount.includes(q),
      );
    }
    return out;
  }, [items, typeFilter, search]);

  const liveSummary: Summary | null = useMemo(() => {
    if (!data) return null;
    let clearedBalance = parseFloat(data.summary.statement_beginning_balance);
    let clearedCount = 0;
    for (const i of items) {
      if (cleared.get(key(i))) { clearedBalance += parseFloat(i.amount); clearedCount++; }
    }
    const difference = parseFloat(data.summary.statement_ending_balance) - clearedBalance;
    return {
      statement_beginning_balance: data.summary.statement_beginning_balance,
      statement_ending_balance: data.summary.statement_ending_balance,
      cleared_balance: clearedBalance.toFixed(2),
      difference: difference.toFixed(2),
      cleared_count: clearedCount,
      total_count: items.length,
      // Fixed at load time — unchecking an item doesn't change whether it was auto-matched.
      auto_matched_count: data.summary.auto_matched_count,
    };
  }, [data, items, cleared]);

  function toggle(item: WorksheetItem) {
    setCleared(prev => {
      const next = new Map(prev);
      next.set(key(item), !next.get(key(item)));
      return next;
    });
  }

  // Operates on the filtered/searched subset on screen, not every item in the
  // reconciliation — ticking "all" while a search is narrowing the list
  // should only touch what's visible, same as the per-row checkboxes below it.
  const allVisibleChecked = visible.length > 0 && visible.every(i => cleared.get(key(i)));
  const someVisibleChecked = visible.some(i => cleared.get(key(i)));
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleChecked && !allVisibleChecked;
  }, [someVisibleChecked, allVisibleChecked]);

  function toggleAllVisible() {
    const nextValue = !allVisibleChecked;
    setCleared(prev => {
      const next = new Map(prev);
      for (const i of visible) next.set(key(i), nextValue);
      return next;
    });
  }

  // The statement-side review (item 72's upload-from-Reconcile piece): split
  // the resolved statement's own lines by whether their detected match is
  // currently cleared, reading live from `cleared` (not the snapshot's own
  // `matched.is_cleared`) so confirming/rejecting here updates the same tabs
  // immediately, the same state the plain checklist below already shares.
  const matchedLines = useMemo(() => (statementMatch?.lines ?? [])
    .filter(l => l.matched && cleared.get(key(l.matched))), [statementMatch, cleared]);
  const unmatchedStatementLines = useMemo(() => (statementMatch?.lines ?? [])
    .filter(l => !l.matched || !cleared.get(key(l.matched))), [statementMatch, cleared]);
  const unmatchedBookItems = useMemo(() => items.filter(i => !cleared.get(key(i))), [items, cleared]);

  function confirmAllHighConfidence() {
    setCleared(prev => {
      const next = new Map(prev);
      for (const l of statementMatch?.lines ?? []) {
        if (l.matched && (l.confidence ?? 0) >= 0.9) next.set(key(l.matched), true);
      }
      return next;
    });
  }

  function setLineCleared(item: { transaction_type: ItemType; transaction_id: string }, value: boolean) {
    setCleared(prev => {
      const next = new Map(prev);
      next.set(key(item), value);
      return next;
    });
  }

  function createTransactionFromLine(line: StatementMatchLine) {
    if (!data) return;
    const draft = statementLineToCreateDraft(line, data.account);
    navigate(chatActionRoute(draft), { state: { chatDraft: draft } satisfies ChatDraftState });
  }

  async function saveForLater() {
    if (!bizId || !id) return;
    setBusy(true); setErr(null);
    try {
      const body = { items: items.map(i => ({ transaction_type: i.transaction_type, transaction_id: i.transaction_id, is_cleared: cleared.get(key(i)) ?? false })) };
      await api.patch(`/businesses/${bizId}/bank-rec/${id}/items`, body);
      navigate('/accounting/reconcile');
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function doFinish(acceptDifference: boolean) {
    if (!bizId || !id) return;
    setBusy(true); setErr(null);
    try {
      // Save the current checked state first, so Finish reconciles exactly what's on screen.
      const body = { items: items.map(i => ({ transaction_type: i.transaction_type, transaction_id: i.transaction_id, is_cleared: cleared.get(key(i)) ?? false })) };
      await api.patch(`/businesses/${bizId}/bank-rec/${id}/items`, body);
      await api.post(`/businesses/${bizId}/bank-rec/${id}/finish`, { accept_difference: acceptDifference });
      setFinishWarning(null);
      navigate('/accounting/reconcile/history');
    } catch (e: unknown) {
      setErr(pickErr(e));
      setFinishWarning(null);
    } finally {
      setBusy(false);
    }
  }

  function clickFinish() {
    if (!liveSummary) return;
    if (parseFloat(liveSummary.difference) !== 0) {
      setFinishWarning(liveSummary.difference);
      return;
    }
    void doFinish(false);
  }

  async function doCancel() {
    if (!bizId || !id) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/bank-rec/${id}/cancel`, {});
      navigate('/accounting/reconcile');
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
      setCancelConfirm(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;
  if (err && !data) return <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</div>;
  if (!data || !liveSummary) return <LoadingIndicator />;

  const diffIsZero = Math.abs(parseFloat(liveSummary.difference)) < 0.005;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reconcile — {data.account.name}</h1>
          <p className="text-sm text-muted-foreground">Statement ending {fmtShortDate(data.reconciliation.statement_ending_date)}</p>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/accounting/reconcile" className="text-sm text-link underline">Back to Reconcile</Link>
          <ReconcileNav active="setup" accountId={data.account.id} />
        </div>
      </div>

      {err && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</div>}

      {liveSummary.auto_matched_count > 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
          Auto-matched {liveSummary.auto_matched_count} of {liveSummary.total_count} transactions against the uploaded bank statement.
          {liveSummary.total_count - liveSummary.auto_matched_count > 0
            ? ` ${liveSummary.total_count - liveSummary.auto_matched_count} item${liveSummary.total_count - liveSummary.auto_matched_count === 1 ? '' : 's'} need${liveSummary.total_count - liveSummary.auto_matched_count === 1 ? 's' : ''} your review.`
            : ' Everything matched.'}
        </div>
      )}

      {statementMatch && (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <div className="text-sm font-medium">
                {matchedLines.length} of {statementMatch.lines.length} statement transactions matched
              </div>
              <div className="mt-1 h-1.5 w-56 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${statementMatch.lines.length === 0 ? 0 : Math.round((matchedLines.length / statementMatch.lines.length) * 100)}%` }}
                />
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              {statementMatch.periodStart && statementMatch.periodEnd && (
                <div>Statement period: {fmtShortDate(statementMatch.periodStart)} – {fmtShortDate(statementMatch.periodEnd)}</div>
              )}
              {statementMatch.openingBalance && statementMatch.closingBalance && (
                <div>{fmtMoney(statementMatch.openingBalance)} → {fmtMoney(statementMatch.closingBalance)}</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 border-b px-4 pt-2">
            {([
              ['matched', `Matched (${matchedLines.length})`],
              ['unmatched_statement', `Unmatched Statement Lines (${unmatchedStatementLines.length})`],
              ['unmatched_book', `Unmatched Book Transactions (${unmatchedBookItems.length})`],
            ] as const).map(([tabKey, label]) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => setMatchTab(tabKey)}
                className={`rounded-t-md px-3 py-1.5 text-sm ${matchTab === tabKey ? 'border-b-2 border-primary font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {matchTab === 'matched' && (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={confirmAllHighConfidence}>
                    Confirm All High-Confidence Matches
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <th className="p-2 text-left">Date</th>
                        <th className="p-2 text-left">Statement Description</th>
                        <th className="p-2 text-right">Amount</th>
                        <th className="p-2 text-center" />
                        <th className="p-2 text-left">Book Description</th>
                        <th className="p-2 text-right">Book Amount</th>
                        <th className="p-2 text-left">Confidence</th>
                        <th className="p-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchedLines.length === 0 && (
                        <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">Nothing confirmed yet.</td></tr>
                      )}
                      {matchedLines.map(l => {
                        const confidence = l.confidence ?? 0;
                        const badgeColor = confidence > 0.9 ? 'bg-emerald-100 text-emerald-700' : confidence >= 0.7 ? 'bg-amber-100 text-amber-700' : 'bg-orange-100 text-orange-700';
                        return (
                          <tr key={l.lineIndex} className="border-b last:border-b-0">
                            <td className="p-2 whitespace-nowrap">{fmtShortDate(l.date)}</td>
                            <td className="p-2">{l.description}</td>
                            <td className="p-2 text-right font-mono">{fmtMoney(l.amount)}</td>
                            <td className="p-2 text-center text-muted-foreground">→</td>
                            <td className="p-2">{l.matched!.name ?? l.matched!.description ?? '—'}</td>
                            <td className="p-2 text-right font-mono">{fmtMoney(l.matched!.amount)}</td>
                            <td className="p-2">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor}`}>{Math.round(confidence * 100)}%</span>
                            </td>
                            <td className="p-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button type="button" aria-label="Confirm match" className="text-emerald-600 hover:text-emerald-700" onClick={() => setLineCleared(l.matched!, true)}>✓</button>
                                <button type="button" aria-label="Reject match" className="text-destructive hover:text-destructive/80" onClick={() => setLineCleared(l.matched!, false)}>✗</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {matchTab === 'unmatched_statement' && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-left">Description</th>
                      <th className="p-2 text-right">Amount</th>
                      <th className="p-2 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmatchedStatementLines.length === 0 && (
                      <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Every statement line matched.</td></tr>
                    )}
                    {unmatchedStatementLines.map(l => (
                      <tr key={l.lineIndex} className="border-b last:border-b-0 align-top">
                        <td className="p-2 whitespace-nowrap">{fmtShortDate(l.date)}</td>
                        <td className="p-2">{l.description}</td>
                        <td className="p-2 text-right font-mono">{fmtMoney(l.amount)}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => setFindMatchFor(findMatchFor === l.lineIndex ? null : l.lineIndex)}>
                              Find Match
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => createTransactionFromLine(l)}>
                              Create Transaction
                            </Button>
                          </div>
                          {findMatchFor === l.lineIndex && (
                            <AppSelect
                              className="mt-2 h-8 w-full max-w-sm rounded-md border bg-background px-2 text-xs"
                              value=""
                              onChange={e => {
                                const picked = unmatchedBookItems.find(i => key(i) === e.target.value);
                                if (picked) setLineCleared(picked, true);
                                setFindMatchFor(null);
                              }}
                            >
                              <option value="">Pick an unreconciled book transaction…</option>
                              {unmatchedBookItems.map(i => (
                                <option key={key(i)} value={key(i)}>
                                  {fmtShortDate(i.transaction_date)} · {i.name ?? i.description ?? i.type_label} · {fmtMoney(Math.abs(parseFloat(i.amount)))}
                                </option>
                              ))}
                            </AppSelect>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {matchTab === 'unmatched_book' && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-left">Type</th>
                      <th className="p-2 text-left">Name</th>
                      <th className="p-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmatchedBookItems.length === 0 && (
                      <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Nothing left unaccounted for.</td></tr>
                    )}
                    {unmatchedBookItems.map(i => (
                      <tr key={key(i)} className="border-b last:border-b-0">
                        <td className="p-2 whitespace-nowrap">{fmtShortDate(i.transaction_date)}</td>
                        <td className="p-2">{i.type_label}</td>
                        <td className="p-2">{i.name ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="p-2 text-right font-mono">{fmtMoney(Math.abs(parseFloat(i.amount)))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-2 pt-2 text-xs text-muted-foreground">
                  <FileSearch className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                  These might be errors, timing differences, or outstanding items — nothing is decided here.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <button type="button" className="flex w-full items-center justify-between px-4 py-2 text-left" onClick={() => setCollapsed(c => !c)}>
          <span className="text-sm font-medium">Summary</span>
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
        {!collapsed && (
          <CardContent className="grid grid-cols-5 gap-4 pt-0 text-sm">
            <div><div className="text-muted-foreground">Statement beginning balance</div><div className="font-mono">{fmtMoney(liveSummary.statement_beginning_balance)}</div></div>
            <div><div className="text-muted-foreground">Statement ending balance</div><div className="font-mono">{fmtMoney(liveSummary.statement_ending_balance)}</div></div>
            <div><div className="text-muted-foreground">Cleared balance</div><div className="font-mono">{fmtMoney(liveSummary.cleared_balance)}</div></div>
            <div>
              <div className="text-muted-foreground">Difference</div>
              <div className={`font-mono font-semibold ${diffIsZero ? 'text-emerald-600' : 'text-destructive'}`}>{fmtMoney(liveSummary.difference)}</div>
            </div>
            <div><div className="text-muted-foreground">Checked</div><div className="font-mono">{liveSummary.cleared_count} of {liveSummary.total_count}</div></div>
          </CardContent>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <AppSelect className="h-9 w-40 rounded-md border bg-background px-3 text-sm" value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}>
          <option value="all">All types</option>
          <option value="deposits">Deposits only</option>
          <option value="payments">Payments only</option>
        </AppSelect>
        <Input className="h-9 max-w-xs" placeholder="Search description or amount" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="p-2 text-left w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allVisibleChecked}
                    onChange={toggleAllVisible}
                    disabled={visible.length === 0}
                    aria-label="Select all"
                    className="h-4 w-4"
                  />
                </th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-left">Ref no.</th>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Memo</th>
                <th className="p-2 text-right">Payment</th>
                <th className="p-2 text-right">Deposit</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">Nothing to clear.</td></tr>
              )}
              {visible.map(item => {
                const amt = parseFloat(item.amount);
                const isChecked = cleared.get(key(item)) ?? false;
                return (
                  <tr key={key(item)} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-2">
                      <div className="flex items-center gap-1.5">
                        <input type="checkbox" checked={isChecked} onChange={() => toggle(item)} className="h-4 w-4" />
                        {item.auto_matched && isChecked && (
                          <span
                            title="Auto-matched against the uploaded bank statement — uncheck if this isn't right"
                            className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700"
                          >
                            Auto
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-2 whitespace-nowrap">{fmtShortDate(item.transaction_date)}</td>
                    <td className="p-2 whitespace-nowrap">{item.type_label}</td>
                    <td className="p-2">
                      <Link to={item.transaction_path} className="text-link underline">{item.ref_no ?? '—'}</Link>
                    </td>
                    <td className="p-2">{item.name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-2 text-muted-foreground">{item.description ?? ''}</td>
                    <td className="p-2 text-right font-mono">{amt < 0 ? fmtMoney(Math.abs(amt)) : ''}</td>
                    <td className="p-2 text-right font-mono">{amt >= 0 ? fmtMoney(amt) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-between border-t pt-4">
        <div>
          {!cancelConfirm ? (
            <Button variant="ghost" className="text-destructive" onClick={() => setCancelConfirm(true)}>Cancel</Button>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span>Discard this reconciliation? Your progress will be lost.</span>
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => void doCancel()}>Discard</Button>
              <Button variant="outline" size="sm" onClick={() => setCancelConfirm(false)}>Keep working</Button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void saveForLater()}>Save for later</Button>
          <Button disabled={busy} onClick={clickFinish}>Finish now</Button>
        </div>
      </div>

      {finishWarning !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-md">
            <CardContent className="space-y-4 p-6">
              <h2 className="text-lg font-semibold">There's a difference</h2>
              <p className="text-sm text-muted-foreground">
                There is a {fmtSigned(finishWarning)} difference between your books and the bank statement.
                Accepting it will create an adjusting journal entry for this amount. Talk to your accountant before proceeding.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setFinishWarning(null)}>Cancel</Button>
                <Button disabled={busy} onClick={() => void doFinish(true)}>Accept difference and finish</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
