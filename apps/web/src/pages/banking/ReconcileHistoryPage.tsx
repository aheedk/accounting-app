import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { hideUnless, useCan } from '@/lib/roleAccess';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';
import { AppSelect } from '../../components/ui/select';

type BankAccount = { id: string; name: string; account_last_four: string | null };

type HistoryRow = {
  id: string;
  bank_account_id: string;
  bank_account_name: string | null;
  statement_ending_date: string;
  statement_ending_balance: string;
  difference: string;
  status: 'completed' | 'cancelled';
  completed_at: string | null;
  completed_by: string | null;
  items_cleared: number;
};

type DetailItem = { transaction_type: string; transaction_id: string; transaction_date: string; description: string | null; amount: string; is_cleared: boolean };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function ReconcileHistoryPage() {
  const can = useCan();
  const [bizId] = useActiveBusinessId();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/bank-accounts`).then(r => setBankAccounts(r.data.bank_accounts)).catch((e: unknown) => setErr(pickErr(e)));
  }, [bizId]);

  function reload() {
    if (!bizId) return;
    setErr(null);
    const params = bankAccountId ? { bank_account_id: bankAccountId } : {};
    api.get(`/businesses/${bizId}/bank-rec/history`, { params })
      .then(r => setRows(r.data.reconciliations))
      .catch((e: unknown) => setErr(pickErr(e)));
  }

  useEffect(reload, [bizId, bankAccountId]);

  async function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); setDetail(null); return; }
    setExpanded(id); setDetail(null);
    if (!bizId) return;
    try {
      const r = await api.get(`/businesses/${bizId}/bank-rec/${id}`);
      setDetail(r.data.items);
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }

  const latestCompletedId = rows.find(r => r.status === 'completed')?.id ?? null;

  async function undo(id: string) {
    if (!bizId) return;
    if (!confirm('Undo this reconciliation? Every transaction it cleared goes back to unreconciled.')) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/bank-rec/${id}/undo`, {});
      reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reconciliation history</h1>
        <Link to="/accounting/reconcile" className="text-sm text-primary underline">Back to Reconcile</Link>
      </div>

      {err && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</div>}

      <div className="w-64">
        <AppSelect className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
          <option value="">All accounts</option>
          {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}{b.account_last_four ? ` •••${b.account_last_four}` : ''}</option>)}
        </AppSelect>
      </div>

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="p-3 text-left">Account</th>
              <th className="p-3 text-left">Statement ending date</th>
              <th className="p-3 text-right">Statement ending balance</th>
              <th className="p-3 text-right">Items cleared</th>
              <th className="p-3 text-right">Difference</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Completed by</th>
              <th className="p-3 text-left">Completed at</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">No reconciliations yet.</td></tr>}
            {rows.map(r => (
              <Fragment key={r.id}>
                <tr className="cursor-pointer border-b hover:bg-muted/30" onClick={() => void toggleExpand(r.id)}>
                  <td className="p-3">{r.bank_account_name}</td>
                  <td className="p-3 whitespace-nowrap">{fmtShortDate(r.statement_ending_date)}</td>
                  <td className="p-3 text-right font-mono">{fmtMoney(r.statement_ending_balance)}</td>
                  <td className="p-3 text-right">{r.items_cleared}</td>
                  <td className="p-3 text-right font-mono">{fmtMoney(r.difference)}</td>
                  <td className="p-3 capitalize">{r.status}</td>
                  <td className="p-3">{r.completed_by ?? '—'}</td>
                  <td className="p-3 whitespace-nowrap">{r.completed_at ? new Date(r.completed_at).toLocaleString() : '—'}</td>
                  <td className="p-3 text-right">
                    {r.status === 'completed' && r.id === latestCompletedId && (
                      <Button
                        variant="outline" size="sm" disabled={busy}
                        {...hideUnless(can.admin)}
                        onClick={ev => { ev.stopPropagation(); void undo(r.id); }}
                      >
                        Undo
                      </Button>
                    )}
                  </td>
                </tr>
                {expanded === r.id && (
                  <tr>
                    <td colSpan={9} className="bg-muted/20 p-3">
                      {!detail ? (
                        <div className="text-sm text-muted-foreground">Loading…</div>
                      ) : (
                        <CardContent className="p-0">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-muted-foreground">
                                <th className="p-1">Date</th><th className="p-1">Type</th><th className="p-1">Description</th><th className="p-1 text-right">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.map(i => (
                                <tr key={`${i.transaction_type}:${i.transaction_id}`}>
                                  <td className="p-1">{fmtShortDate(i.transaction_date)}</td>
                                  <td className="p-1 capitalize">{i.transaction_type.replace('_', ' ')}</td>
                                  <td className="p-1">{i.description ?? ''}</td>
                                  <td className="p-1 text-right font-mono">{fmtMoney(i.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </CardContent>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
