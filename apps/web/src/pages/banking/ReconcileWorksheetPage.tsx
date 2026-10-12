import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney, fmtSigned } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';
import { AppSelect } from '../../components/ui/select';
import { ReconcileNav } from './ReconcileNav';

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
  transaction_path: string;
};

type Summary = {
  statement_beginning_balance: string;
  statement_ending_balance: string;
  cleared_balance: string;
  difference: string;
  cleared_count: number;
  total_count: number;
};

type Worksheet = {
  reconciliation: { id: string; account_id: string; status: string; statement_ending_date: string };
  account: { id: string; name: string };
  category: string;
  items: WorksheetItem[];
  summary: Summary;
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
    };
  }, [data, items, cleared]);

  function toggle(item: WorksheetItem) {
    setCleared(prev => {
      const next = new Map(prev);
      next.set(key(item), !next.get(key(item)));
      return next;
    });
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
  if (!data || !liveSummary) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const diffIsZero = Math.abs(parseFloat(liveSummary.difference)) < 0.005;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reconcile — {data.account.name}</h1>
          <p className="text-sm text-muted-foreground">Statement ending {fmtShortDate(data.reconciliation.statement_ending_date)}</p>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/accounting/reconcile" className="text-sm text-primary underline">Back to Reconcile</Link>
          <ReconcileNav active="setup" accountId={data.account.id} />
        </div>
      </div>

      {err && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</div>}

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
                <th className="p-2 text-left w-10"></th>
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
                      <input type="checkbox" checked={isChecked} onChange={() => toggle(item)} className="h-4 w-4" />
                    </td>
                    <td className="p-2 whitespace-nowrap">{fmtShortDate(item.transaction_date)}</td>
                    <td className="p-2 whitespace-nowrap">{item.type_label}</td>
                    <td className="p-2">
                      <Link to={item.transaction_path} className="text-primary underline">{item.ref_no ?? '—'}</Link>
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
