import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { CheckCircle2, Upload } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { pickErr } from '@/lib/apiErrors';
import { fmtDateTime, fmtLongDate, todayLocal } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import {
  parseAccounts, parseContacts, parseItems, parseJournal, parseOpenItems, parseTrialBalance, parseUncleared,
  type Grid, type OpenItemRow, type Parsed,
} from '@/lib/qbImport';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { AccountSelect, type AccountLike } from '@/components/ui/AccountSelect';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';

// Setup -> Import from QuickBooks: moving a client over from QuickBooks' own
// exports, one step at a time. Each file is checked first (the API runs it
// and rolls it back) and only brought in when nothing is wrong with it; every
// upload can be undone. Spec: docs/specs/2026-10-28-quickbooks-import-design.md.

type StepKey = 'accounts' | 'customers' | 'vendors' | 'items' | 'open_invoices' | 'open_bills' | 'uncleared' | 'history' | 'trial_balance';
type Problem = { row: number | null; message: string };
type Result = { batch_id: string | null; problems: Problem[]; notes: string[]; counts: Record<string, number>; preview?: unknown; dry_run: boolean };
type Batch = {
  id: string; step: StepKey; cutover_date: string; file_name: string | null; created_at: string;
  undone_at: string | null; created_by: string | null; record_count: number; summary: Record<string, unknown> | null;
};
type OpeningLine = { account_id: string; code: string; name: string; quickbooks: string; here: string; entry: string };
type CheckResult = {
  cutover_date: string | null; posted: boolean; differences: number;
  rows: { account_id: string; code: string; name: string; quickbooks: string; here: string; difference: string }[];
};

type StepDef = {
  key: StepKey;
  path: string;
  title: string;
  /** Where in QuickBooks the file comes from. */
  source: string;
  read: (grid: Grid) => Parsed<unknown>;
  /** The request body, from the rows read. */
  body: (rows: unknown[]) => Record<string, unknown>;
  optional?: boolean;
};

const openItems = (rows: unknown[], party: 'customer' | 'vendor') => ({
  rows: (rows as OpenItemRow[]).map(({ name, ...rest }) => ({ [party]: name, ...rest })),
});

const STEPS: StepDef[] = [
  {
    key: 'accounts', path: 'accounts', title: 'Chart of accounts',
    source: 'Reports → Account List → Export to Excel (or Chart of Accounts → Run report).',
    read: parseAccounts, body: rows => ({ rows }),
  },
  {
    key: 'customers', path: 'customers', title: 'Customers',
    source: 'Reports → Customer Contact List → Export to Excel (add the billing address and terms columns), or Sales → Customers → Export.',
    read: grid => parseContacts(grid, 'Customers'), body: rows => ({ rows }),
  },
  {
    key: 'vendors', path: 'vendors', title: 'Vendors',
    source: 'Reports → Vendor Contact List → Export to Excel, or Expenses → Vendors → Export.',
    read: grid => parseContacts(grid, 'Vendors'), body: rows => ({ rows }),
  },
  {
    key: 'items', path: 'items', title: 'Products and services',
    source: 'Sales → Products and services → Export to Excel. Stock items bring their quantity on hand as opening stock.',
    read: parseItems, body: rows => ({ rows }),
  },
  {
    key: 'open_invoices', path: 'open-invoices', title: 'Open invoices',
    source: 'Reports → Open Invoices, as of the cutover date → Export to Excel. Credit memos and unapplied payments come in as credits.',
    read: grid => parseOpenItems(grid, 'Open Invoices'), body: rows => openItems(rows, 'customer'),
  },
  {
    key: 'open_bills', path: 'open-bills', title: 'Unpaid bills',
    source: 'Reports → Unpaid Bills, as of the cutover date → Export to Excel. Vendor credits come in as credits.',
    read: grid => parseOpenItems(grid, 'Unpaid Bills'), body: rows => openItems(rows, 'vendor'),
  },
  {
    key: 'uncleared', path: 'uncleared', title: 'Uncleared bank and card items',
    source: 'For each bank and credit card account: the reconciliation report for the last statement before the cutover date (its uncleared sections), exported to Excel. One account an upload.',
    read: parseUncleared, body: rows => ({ rows }),
  },
  {
    key: 'history', path: 'history', title: 'History', optional: true,
    source: 'Reports → Journal, from the first date wanted to the cutover date → Export to Excel. Optional: without it, past reports stay in QuickBooks.',
    read: parseJournal, body: rows => ({ transactions: rows }),
  },
  {
    key: 'trial_balance', path: 'trial-balance', title: 'Opening balances',
    source: 'Reports → Trial Balance, as of the cutover date → Export to Excel. Do this last: it brings every account to QuickBooks\' figures from what the steps above brought in.',
    read: parseTrialBalance, body: rows => ({ lines: rows }),
  },
];

const STEP_TITLE = Object.fromEntries(STEPS.map(s => [s.key, s.title])) as Record<StepKey, string>;

async function readGrid(file: File): Promise<Grid> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false })
    .map(row => row.map(c => (c === null || c === undefined ? '' : String(c))));
}

/** The last day of last month: where a move usually starts. */
function lastMonthEnd(): string {
  const [y, m] = todayLocal().split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1, 0));
  return d.toISOString().slice(0, 10);
}

const countLabel = (counts: Record<string, number>) =>
  Object.entries(counts).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ');

function ResultView({ result }: { result: Result }) {
  const lines = (result.preview as { lines?: OpeningLine[] } | undefined)?.lines;
  return (
    <div className="space-y-2 text-sm">
      {result.problems.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="font-medium text-destructive">Fix these first. Nothing is brought in while any is left:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {result.problems.map((p, i) => <li key={i}>{p.row !== null ? `Row ${p.row + 1}: ` : ''}{p.message}</li>)}
          </ul>
        </div>
      )}
      {Object.keys(result.counts).length > 0 && (
        <p>{result.dry_run ? 'Would bring in: ' : 'Brought in: '}{countLabel(result.counts)}</p>
      )}
      {result.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {result.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      {lines && lines.length > 0 && (
        <div className="max-h-80 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th className="px-3 py-1.5">Account</th>
                <th className="px-3 py-1.5 text-right">QuickBooks</th>
                <th className="px-3 py-1.5 text-right">Here already</th>
                <th className="px-3 py-1.5 text-right">Opening entry</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.account_id} className="border-t">
                  <td className="px-3 py-1">{l.code} {l.name}</td>
                  <td className="px-3 py-1 text-right font-mono">{fmtMoney(l.quickbooks)}</td>
                  <td className="px-3 py-1 text-right font-mono">{fmtMoney(l.here)}</td>
                  <td className="px-3 py-1 text-right font-mono">{Number(l.entry) === 0 ? '—' : fmtMoney(l.entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-1.5 text-xs text-muted-foreground">Debits are positive, credits negative.</p>
        </div>
      )}
    </div>
  );
}

function StepCard({
  def, index, bizId, cutover, done, accounts, onDone,
}: {
  def: StepDef; index: number; bizId: string; cutover: string; done: Batch[]; accounts: AccountLike[]; onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Parsed<unknown> | null>(null);
  const [accountId, setAccountId] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const needsAccount = def.key === 'uncleared';
  const account = accounts.find(a => a.id === accountId);

  const send = useCallback(async (rows: unknown[], dryRun: boolean) => {
    setBusy(true); setErr(null);
    try {
      const body = {
        cutover_date: cutover, file_name: file?.name ?? null, ...def.body(rows),
        ...(needsAccount && account ? { account: `${account.code} ${account.name}` } : {}),
      };
      const r = await api.post<Result>(`/businesses/${bizId}/qb-import/${def.path}${dryRun ? '?dry_run=true' : ''}`, body);
      setResult(r.data);
      if (!dryRun) { setFile(null); setParsed(null); onDone(); }
    } catch (e: unknown) {
      const data = (e as { response?: { data?: Result } }).response?.data;
      if (data && Array.isArray(data.problems)) setResult(data);
      else setErr(pickErr(e));
    } finally { setBusy(false); }
  }, [account, bizId, cutover, def, file, needsAccount, onDone]);

  async function choose(f: File | null) {
    setFile(f); setResult(null); setErr(null); setParsed(null);
    if (!f) return;
    try {
      const p = def.read(await readGrid(f));
      setParsed(p);
    } catch {
      setErr('That file could not be read. Export it from QuickBooks as Excel (.xlsx) or CSV.');
    }
  }

  // Check the file as soon as it is read, and again when the account changes.
  useEffect(() => {
    if (!parsed || parsed.problems.length > 0 || (needsAccount && !account)) return;
    if (parsed.rows.length === 0 && !needsAccount) return;
    void send(parsed.rows, true);
  }, [parsed, account, needsAccount]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = done.filter(b => !b.undone_at);
  const canBringIn = !!parsed && parsed.problems.length === 0 && !!result?.dry_run && result.problems.length === 0 && !busy;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="text-muted-foreground">{index + 1}.</span> {def.title}
          {def.optional && <span className="text-xs font-normal text-muted-foreground">(optional)</span>}
          {active.length > 0 && <CheckCircle2 className="h-4 w-4 text-green-600" aria-label="Done" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{def.source}</p>
        {active.length > 0 && (
          <p className="text-sm">
            Brought in: {active.map(b => `${b.record_count} from ${b.file_name ?? 'an upload'}${typeof b.summary?.['account'] === 'string' ? ` (${b.summary['account'] as string})` : ''}`).join('; ')}
          </p>
        )}
        {needsAccount && (
          <div className="max-w-md space-y-1.5">
            <Label>Account</Label>
            <AccountSelect
              accounts={accounts.filter(a => a.account_type === 'asset' || a.account_type === 'liability')}
              value={accountId} onChange={setAccountId} placeholder="The bank or credit card account…"
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
            <Upload className="h-4 w-4" />
            {file ? file.name : 'Choose the export…'}
            <input
              type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { void choose(e.target.files?.[0] ?? null); e.target.value = ''; }}
            />
          </label>
          {needsAccount && account && !file && (
            <Button type="button" variant="outline" size="sm" disabled={busy}
              onClick={() => { setParsed({ rows: [], problems: [] }); }}>
              Nothing was uncleared
            </Button>
          )}
          {parsed && parsed.problems.length === 0 && (
            <span className="text-sm text-muted-foreground">{parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} read</span>
          )}
          {busy && <LoadingIndicator />}
        </div>
        {parsed && parsed.problems.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-destructive">
            {parsed.problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
        {result && <ResultView result={result} />}
        {canBringIn && (
          <Button type="button" onClick={() => void send(parsed.rows, false)}>
            {def.key === 'trial_balance' ? 'Post the opening balances' : 'Bring them in'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CheckCard({ check }: { check: CheckResult | null }) {
  if (!check?.posted) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-3 text-sm text-muted-foreground">
          Once the opening balances are posted, this compares every account with QuickBooks' trial balance at the cutover date.
        </CardContent>
      </Card>
    );
  }
  const differing = check.rows.filter(r => Number(r.difference) !== 0);
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">The check</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {differing.length === 0
          ? <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" /> All {check.rows.length} accounts match QuickBooks at {fmtLongDate(check.cutover_date!)}.</p>
          : (
            <>
              <p className="text-destructive">{differing.length} account{differing.length === 1 ? '' : 's'} differ from QuickBooks at {fmtLongDate(check.cutover_date!)}:</p>
              <table className="w-full max-w-2xl text-sm">
                <thead className="text-left"><tr><th>Account</th><th className="text-right">QuickBooks</th><th className="text-right">Here</th><th className="text-right">Difference</th></tr></thead>
                <tbody>
                  {differing.map(r => (
                    <tr key={r.account_id} className="border-t">
                      <td>{r.code} {r.name}</td>
                      <td className="text-right font-mono">{fmtMoney(r.quickbooks)}</td>
                      <td className="text-right font-mono">{fmtMoney(r.here)}</td>
                      <td className="text-right font-mono">{fmtMoney(r.difference)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
      </CardContent>
    </Card>
  );
}

export default function QuickBooksImportPage() {
  const [bizId] = useActiveBusinessId();
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [cutover, setCutover] = useState(lastMonthEnd());
  const [locked, setLocked] = useState(false);
  const [accounts, setAccounts] = useState<AccountLike[]>([]);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!bizId) return;
    try {
      const [list, coa, chk] = await Promise.all([
        api.get<{ cutover_date: string | null; batches: Batch[] }>(`/businesses/${bizId}/qb-import`),
        api.get<{ accounts: (AccountLike & { is_active: boolean })[] }>(`/businesses/${bizId}/coa`),
        api.get<CheckResult>(`/businesses/${bizId}/qb-import/check`),
      ]);
      setBatches(list.data.batches);
      if (list.data.cutover_date) setCutover(list.data.cutover_date);
      setLocked(list.data.cutover_date !== null);
      setAccounts(coa.data.accounts.filter(a => a.is_active !== false));
      setCheck(chk.data);
    } catch (e: unknown) { setErr(pickErr(e)); }
  }, [bizId]);

  useEffect(() => { void reload(); }, [reload]);

  const byStep = useMemo(() => {
    const map = new Map<StepKey, Batch[]>();
    for (const b of batches ?? []) map.set(b.step, [...(map.get(b.step) ?? []), b]);
    return map;
  }, [batches]);

  async function undo(id: string) {
    if (!bizId) return;
    setUndoing(id); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/qb-import/batches/${id}/undo`, {});
      setConfirmUndo(null);
      await reload();
    } catch (e: unknown) { setErr(pickErr(e)); } finally { setUndoing(null); }
  }

  if (!bizId) return <p className="text-sm text-muted-foreground">Choose a company first.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import from QuickBooks</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Moves this company over from QuickBooks Online using QuickBooks' own exports. Each file is checked before anything is
          brought in, and every upload can be undone. Work down the steps in order; the opening balances go last.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="qb-cutover">Cutover date</Label>
            <DateInput id="qb-cutover" value={cutover} onChange={e => setCutover(e.target.value)} disabled={locked} />
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            {locked
              ? 'Every upload for this company is on this date. Undo them all to change it.'
              : 'The last day kept in QuickBooks. A month end is simplest; from the day after, the team enters everything here.'}
          </p>
        </CardContent>
      </Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {batches === null ? <LoadingIndicator /> : (
        <>
          <div className="space-y-4">
            {STEPS.map((def, i) => (
              <StepCard
                key={def.key} def={def} index={i} bizId={bizId} cutover={cutover}
                done={byStep.get(def.key) ?? []} accounts={accounts} onDone={() => { void reload(); }}
              />
            ))}
          </div>

          <CheckCard check={check} />

          {batches.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Uploads</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr><th className="py-1.5">Step</th><th>File</th><th className="text-right">Records</th><th>When</th><th>By</th><th /></tr>
                  </thead>
                  <tbody>
                    {batches.map(b => (
                      <tr key={b.id} className={`border-t ${b.undone_at ? 'text-muted-foreground line-through' : ''}`}>
                        <td className="py-1.5">{STEP_TITLE[b.step]}</td>
                        <td>{b.file_name ?? '—'}</td>
                        <td className="text-right">{b.record_count}</td>
                        <td>{fmtDateTime(b.created_at)}</td>
                        <td>{b.created_by ?? '—'}</td>
                        <td className="text-right">
                          {!b.undone_at && (confirmUndo === b.id
                            ? (
                              <span className="inline-flex gap-2">
                                <Button type="button" size="sm" variant="destructive" disabled={undoing === b.id} onClick={() => void undo(b.id)}>Undo it</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmUndo(null)}>Keep</Button>
                              </span>
                            )
                            : <Button type="button" size="sm" variant="outline" onClick={() => setConfirmUndo(b.id)}>Undo</Button>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
