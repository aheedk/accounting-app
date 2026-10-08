import { useCallback, useEffect, useState } from 'react';
import { hideUnless, useCan } from '@/lib/roleAccess';
import { Link } from 'react-router-dom';
import { Receipt, ExternalLink } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { fmtMoney } from '@/lib/money';
import { AppSelect } from '../../components/ui/select';

type Account = { id: string; code: string; name: string; account_type: string };

type PostedCheck = {
  kind: 'expense' | 'imported';
  id: string;
  journal_entry_id: string;
  date: string;
  payee: string | null;
  path: string;
};

type CheckStub = {
  id: string;
  check_number: string | null;
  check_date: string | null;
  payee_name: string | null;
  amount: string;
  memo: string | null;
  suggested_account_name: string | null;
  suggested_account_id: string | null;
  status: 'unmatched' | 'matched' | 'dismissed';
  matched_journal_entry_id: string | null;
  source_filename: string | null;
  source_file_id: string | null;
  posted_check: PostedCheck | null;
};

const STATUS_STYLE: Record<CheckStub['status'], string> = {
  unmatched: 'bg-amber-100 text-amber-900',
  matched: 'bg-emerald-100 text-emerald-800',
  dismissed: 'bg-muted text-muted-foreground',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${Number(m)}/${Number(d)}/${y}` : iso;
}

/**
 * Check stubs read from uploads. A stub is used when its check shows up on a
 * bank statement (it fills in payee and category there), or -- for a check
 * already in the books -- by "Apply" here.
 */
export default function CheckStubsPanel({ accounts }: { accounts: Account[] }) {
  // What this login may do here; anything it may not is left off the page.
  const can = useCan();
  const [bizId] = useActiveBusinessId();
  const [stubs, setStubs] = useState<CheckStub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    try {
      const res = await api.get<{ stubs: CheckStub[] }>(`/businesses/${bizId}/check-stubs`);
      setStubs(res.data.stubs);
      setError(null);
    } catch (e: unknown) {
      setError(pickErr(e));
    } finally {
      setLoading(false);
    }
  }, [bizId]);

  useEffect(() => { void load(); }, [load]);

  async function apply(stub: CheckStub) {
    if (!bizId) return;
    setBusyId(stub.id);
    setError(null);
    try {
      const category = categories[stub.id] ?? stub.suggested_account_id ?? null;
      await api.post(`/businesses/${bizId}/check-stubs/${stub.id}/apply`, { category_account_id: category });
      await load();
    } catch (e: unknown) {
      setError(pickErr(e));
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(stub: CheckStub) {
    if (!bizId) return;
    setBusyId(stub.id);
    try {
      await api.post(`/businesses/${bizId}/check-stubs/${stub.id}/dismiss`, {});
      await load();
    } catch (e: unknown) {
      setError(pickErr(e));
    } finally {
      setBusyId(null);
    }
  }

  async function openSource(fileId: string) {
    if (!bizId) return;
    try {
      const res = await api.get(`/businesses/${bizId}/files/${fileId}/download`, { responseType: 'blob' });
      window.open(URL.createObjectURL(res.data as Blob), '_blank', 'noopener');
    } catch (e: unknown) {
      setError(pickErr(e));
    }
  }

  const categoryAccounts = accounts.filter(a => a.account_type === 'expense' || a.account_type === 'asset' || a.account_type === 'liability');
  const visible = showAll ? stubs : stubs.filter(s => s.status === 'unmatched');
  const unmatched = stubs.filter(s => s.status === 'unmatched').length;

  if (loading) return <p className="text-sm text-muted-foreground">Loading check stubs…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Upload check stubs, a check register, or photos of checks above. When a check shows up on a bank
          statement its payee and category are filled in from the stub.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Show used and dismissed
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {visible.length === 0 ? (
        <div className="rounded-lg border bg-muted/20 p-12 text-center">
          <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">{stubs.length === 0 ? 'No check stubs yet' : 'No unmatched check stubs'}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {stubs.length === 0
              ? 'Drop check stubs or a check register (PDF or photo) in the upload box above.'
              : 'Every stub has been matched to a check. Tick "Show used and dismissed" to see them.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/30 text-xs font-semibold uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left">Check #</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Payee</th>
                <th className="px-3 py-2 text-left">Memo</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left min-w-[260px]">In the books</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(stub => (
                <tr key={stub.id} className="border-b align-top">
                  <td className="px-3 py-2 font-mono text-xs">{stub.check_number ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{fmtDate(stub.check_date)}</td>
                  <td className="px-3 py-2">{stub.payee_name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 max-w-[220px] truncate" title={stub.memo ?? undefined}>{stub.memo ?? ''}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtMoney(stub.amount)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLE[stub.status]}`}>
                      {stub.status === 'matched' ? 'used' : stub.status}
                    </span>
                    {stub.source_file_id && (
                      <button type="button" onClick={() => { void openSource(stub.source_file_id!); }}
                        className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline">
                        <ExternalLink className="h-3 w-3" />Stub
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {stub.status === 'matched' && stub.matched_journal_entry_id && (
                      <Link to={`/journal/${stub.matched_journal_entry_id}`} className="text-xs text-primary hover:underline">Open the check</Link>
                    )}
                    {stub.status === 'unmatched' && !stub.posted_check && (
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>Waiting for this check on a bank statement.</span>
                        <button type="button" {...hideUnless(can.accountant)} onClick={() => { void dismiss(stub); }} disabled={busyId === stub.id}
                          className="shrink-0 text-destructive hover:underline disabled:opacity-50">Dismiss</button>
                      </div>
                    )}
                    {stub.status === 'unmatched' && stub.posted_check && (
                      <div className="space-y-1.5 text-xs">
                        <p>
                          Already posted on {fmtDate(stub.posted_check.date)}
                          {stub.posted_check.payee ? ` as “${stub.posted_check.payee}”` : ''}.{' '}
                          <Link to={stub.posted_check.path} className="text-primary hover:underline">Open</Link>
                        </p>
                        <AppSelect
                          value={categories[stub.id] ?? stub.suggested_account_id ?? ''}
                          onChange={e => setCategories(prev => ({ ...prev, [stub.id]: e.target.value }))}
                          className="w-full rounded border bg-background px-2 py-1 text-xs"
                        >
                          <option value="">Keep its current category</option>
                          {categoryAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                        </AppSelect>
                        <div className="flex gap-2">
                          <button type="button" {...hideUnless(can.accountant)} onClick={() => { void apply(stub); }} disabled={busyId === stub.id}
                            className="inline-flex h-7 items-center rounded-md bg-primary px-3 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                            {busyId === stub.id ? 'Applying…' : 'Apply payee and category'}
                          </button>
                          <button type="button" {...hideUnless(can.accountant)} onClick={() => { void dismiss(stub); }} disabled={busyId === stub.id}
                            className="text-destructive hover:underline disabled:opacity-50">Dismiss</button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unmatched > 0 && !showAll && (
        <p className="text-xs text-muted-foreground">{unmatched} unmatched {unmatched === 1 ? 'stub' : 'stubs'}.</p>
      )}
    </div>
  );
}
