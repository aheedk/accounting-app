import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type IntegrationSource = 'stripe_csv' | 'paypal_csv' | 'shopify_csv' | 'generic';
type IntegrationInboxStatus = 'pending' | 'matched' | 'categorized' | 'excluded';
type StatusFilter = IntegrationInboxStatus | 'all';
type SourceFilter = IntegrationSource | 'all';

type IntegrationInboxRow = {
  id: string;
  business_id: string;
  source: IntegrationSource;
  external_id: string | null;
  occurred_at: string;
  description: string;
  amount: string;
  status: IntegrationInboxStatus;
  matched_journal_entry_id: string | null;
  excluded_reason: string | null;
};

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_system: boolean;
  is_active: boolean;
};

type ImportRowInput = {
  occurred_at: string;
  description: string;
  amount: string;
  external_id: string | null;
};

type ActionMode = 'match' | 'categorize' | 'exclude';

type ActionFormState = {
  rowId: string;
  mode: ActionMode;
  journal_entry_id: string;
  cash_account_id: string;
  offset_account_id: string;
  memo: string;
  excluded_reason: string;
};

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'matched', label: 'Matched' },
  { value: 'categorized', label: 'Categorized' },
  { value: 'excluded', label: 'Excluded' },
  { value: 'all', label: 'All' },
];

const SOURCE_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'stripe_csv', label: 'Stripe CSV' },
  { value: 'paypal_csv', label: 'PayPal CSV' },
  { value: 'shopify_csv', label: 'Shopify CSV' },
  { value: 'generic', label: 'Generic CSV' },
];

const IMPORT_SOURCE_OPTIONS: Array<{ value: IntegrationSource; label: string }> = [
  { value: 'stripe_csv', label: 'Stripe CSV' },
  { value: 'paypal_csv', label: 'PayPal CSV' },
  { value: 'shopify_csv', label: 'Shopify CSV' },
  { value: 'generic', label: 'Generic CSV' },
];

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

function statusBadge(status: IntegrationInboxStatus) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  switch (status) {
    case 'pending':
      return <span className={`${base} bg-amber-100 text-amber-800`}>pending</span>;
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

function sourceLabel(source: IntegrationSource): string {
  switch (source) {
    case 'stripe_csv': return 'Stripe';
    case 'paypal_csv': return 'PayPal';
    case 'shopify_csv': return 'Shopify';
    case 'generic': return 'Generic';
    default: return source;
  }
}

// Naive CSV line splitter that handles simple quoted fields. Sufficient for
// our paste-from-spreadsheet MVP — for complex CSVs the user should clean
// the data first.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// Parse pasted CSV into ImportRowInput[]. Expected columns:
// date,description,amount,external_id (header optional). Skips blank lines.
// Throws with a descriptive message on the first invalid row.
function parseCsvText(text: string): ImportRowInput[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [];
  const startIdx = (() => {
    const first = lines[0];
    if (!first) return 0;
    const lower = first.toLowerCase();
    const isHeader = lower.includes('date') && lower.includes('amount');
    return isHeader ? 1 : 0;
  })();
  const rows: ImportRowInput[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 3) {
      throw new Error(`Row ${i + 1}: need at least date,description,amount (got ${cols.length} columns)`);
    }
    const occurred_at = cols[0] ?? '';
    const description = cols[1] ?? '';
    const amount = cols[2] ?? '';
    const external_id = (cols[3] ?? '').trim() || null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurred_at)) {
      throw new Error(`Row ${i + 1}: date must be YYYY-MM-DD (got "${occurred_at}")`);
    }
    if (description.length === 0) {
      throw new Error(`Row ${i + 1}: description is required`);
    }
    if (!/^-?\d+(\.\d+)?$/.test(amount)) {
      throw new Error(`Row ${i + 1}: amount must be numeric (got "${amount}")`);
    }
    rows.push({ occurred_at, description, amount, external_id });
  }
  return rows;
}

function defaultOffsetType(amount: string): 'revenue' | 'expense' {
  const n = parseFloat(amount);
  if (Number.isFinite(n) && n >= 0) return 'revenue';
  return 'expense';
}

export default function IntegrationInboxPage() {
  const [bizId] = useActiveBusinessId();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [rows, setRows] = useState<IntegrationInboxRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [action, setAction] = useState<ActionFormState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  // Inline import state
  const [importSource, setImportSource] = useState<IntegrationSource>('generic');
  const [csvText, setCsvText] = useState<string>('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Load CoA once per biz (used by categorize form).
  useEffect(() => {
    if (!bizId) return;
    (async () => {
      try {
        const r = await api.get(`/businesses/${bizId}/coa`);
        setAccounts(r.data.accounts);
      } catch (e: unknown) {
        setErr(pickErr(e));
      }
    })();
  }, [bizId]);

  const reload = useMemo(() => async () => {
    if (!bizId) { setRows([]); return; }
    setLoading(true);
    try {
      const params: { status?: IntegrationInboxStatus; source?: IntegrationSource } = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (sourceFilter !== 'all') params.source = sourceFilter;
      const r = await api.get(`/businesses/${bizId}/integration-inbox`, { params });
      setRows(r.data.integration_inbox);
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setLoading(false);
    }
  }, [bizId, statusFilter, sourceFilter]);

  useEffect(() => { reload(); }, [reload]);

  function openAction(t: IntegrationInboxRow, mode: ActionMode) {
    setErr(null);
    const defaultType = defaultOffsetType(t.amount);
    const defaultOffset = accounts.find(a => a.account_type === defaultType && a.is_active)?.id ?? '';
    const defaultCash = accounts.find(a => a.account_type === 'asset' && a.is_active)?.id ?? '';
    setAction({
      rowId: t.id,
      mode,
      journal_entry_id: '',
      cash_account_id: defaultCash,
      offset_account_id: defaultOffset,
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
      await api.post(`/businesses/${bizId}/integration-inbox/${action.rowId}/match`, {
        journal_entry_id: action.journal_entry_id.trim(),
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
      const body: { cash_account_id: string; offset_account_id: string; memo?: string } = {
        cash_account_id: action.cash_account_id,
        offset_account_id: action.offset_account_id,
      };
      if (action.memo.trim()) body.memo = action.memo.trim();
      await api.post(`/businesses/${bizId}/integration-inbox/${action.rowId}/categorize`, body);
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
      await api.post(`/businesses/${bizId}/integration-inbox/${action.rowId}/exclude`, {
        excluded_reason: action.excluded_reason.trim(),
      });
      closeAction();
      await reload();
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  async function submitImport(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId) return;
    setImportMsg(null); setErr(null);
    let parsed: ImportRowInput[];
    try {
      parsed = parseCsvText(csvText);
    } catch (parseErr: unknown) {
      const msg = parseErr instanceof Error ? parseErr.message : 'Failed to parse CSV';
      setImportMsg(`Parse error: ${msg}`);
      return;
    }
    if (parsed.length === 0) {
      setImportMsg('No rows to import — paste CSV with at least one data row.');
      return;
    }
    setImporting(true);
    try {
      const r = await api.post(`/businesses/${bizId}/integration-inbox/import`, {
        source: importSource,
        rows: parsed,
      });
      const data = r.data as { inserted?: number; skipped_duplicates?: number };
      const inserted = data.inserted ?? parsed.length;
      const skipped = data.skipped_duplicates ?? 0;
      setImportMsg(`Imported ${inserted} row${inserted === 1 ? '' : 's'}${skipped ? ` (${skipped} duplicate${skipped === 1 ? '' : 's'} skipped)` : ''}.`);
      setCsvText('');
      await reload();
    } catch (e: unknown) {
      setImportMsg(`Import failed: ${pickErr(e)}`);
    } finally {
      setImporting(false);
    }
  }

  // Cash account dropdown: assets only (mirrors banking's cash_account_id constraint).
  const cashAccounts = useMemo(
    () => accounts
      .filter(a => a.is_active && a.account_type === 'asset')
      .slice()
      .sort((x, y) => x.code.localeCompare(y.code)),
    [accounts],
  );

  // Offset dropdown: any active account, grouped by type.
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Integration Transactions</h1>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Source</div>
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value as SourceFilter)}
          >
            {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Import CSV</h2>
            <p className="text-xs text-muted-foreground">
              Columns: <code>date,description,amount,external_id</code> (header row optional)
            </p>
          </div>
          <form className="grid grid-cols-1 gap-3 md:grid-cols-12" onSubmit={submitImport}>
            <div className="md:col-span-3">
              <Label>Source</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={importSource}
                onChange={e => setImportSource(e.target.value as IntegrationSource)}
              >
                {IMPORT_SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-9">
              <Label>CSV rows</Label>
              <textarea
                className="min-h-[120px] w-full rounded-md border bg-background p-2 font-mono text-xs"
                value={csvText}
                onChange={e => setCsvText(e.target.value)}
                placeholder={'2026-04-01,Stripe payout,1234.56,po_abc123\n2026-04-02,Refund,-50.00,re_xyz'}
              />
            </div>
            <div className="md:col-span-12 flex items-center gap-3">
              <Button type="submit" disabled={importing || !csvText.trim()}>
                {importing ? 'Importing…' : 'Import'}
              </Button>
              {importMsg && <span className="text-sm text-muted-foreground">{importMsg}</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Source</th>
              <th className="text-left p-3">Description</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">{loading ? 'Loading…' : 'No transactions match the current filter.'}</td></tr>
            )}
            {rows.map(t => {
              const n = parseFloat(t.amount);
              const positive = Number.isFinite(n) && n >= 0;
              const isOpen = action?.rowId === t.id;
              return (
                <Fragment key={t.id}>
                  <tr className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 whitespace-nowrap">{fmtShortDate(t.occurred_at)}</td>
                    <td className="p-3 text-xs text-muted-foreground">{sourceLabel(t.source)}</td>
                    <td className="p-3">
                      {t.description}
                      {t.external_id && (
                        <span className="ml-2 text-xs text-muted-foreground font-mono">{t.external_id}</span>
                      )}
                    </td>
                    <td className={`p-3 text-right font-mono ${positive ? 'text-emerald-700' : 'text-destructive'}`}>
                      {fmtMoney(t.amount)}
                    </td>
                    <td className="p-3">{statusBadge(t.status)}</td>
                    <td className="p-3">
                      {t.status === 'pending' && (
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="outline" onClick={() => openAction(t, 'match')} disabled={busy}>Match</Button>
                          <Button size="sm" variant="outline" onClick={() => openAction(t, 'categorize')} disabled={busy}>Categorize</Button>
                          <Button size="sm" variant="ghost" onClick={() => openAction(t, 'exclude')} disabled={busy}>Exclude</Button>
                        </div>
                      )}
                      {t.status !== 'pending' && (
                        <div className="flex items-center gap-2">
                          {t.matched_journal_entry_id && (
                            <Link to={`/journal/${t.matched_journal_entry_id}`} className="text-primary underline font-mono text-xs">
                              JE {t.matched_journal_entry_id.slice(0, 8)}
                            </Link>
                          )}
                          {t.status === 'excluded' && t.excluded_reason && (
                            <span className="text-xs text-muted-foreground">reason: {t.excluded_reason}</span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {isOpen && action && (
                    <tr className="bg-muted/20">
                      <td colSpan={6} className="p-4">
                        {action.mode === 'match' && (
                          <form className="grid grid-cols-12 gap-2 items-end" onSubmit={submitMatch}>
                            <div className="col-span-9">
                              <Label>Journal entry id</Label>
                              <Input
                                value={action.journal_entry_id}
                                onChange={e => setAction(a => (a ? { ...a, journal_entry_id: e.target.value } : a))}
                                placeholder="Paste JE UUID"
                                required
                              />
                            </div>
                            <div className="col-span-3 flex gap-2">
                              <Button type="submit" size="sm" disabled={busy || !action.journal_entry_id.trim()}>Submit</Button>
                              <Button type="button" size="sm" variant="ghost" onClick={closeAction} disabled={busy}>Cancel</Button>
                            </div>
                          </form>
                        )}
                        {action.mode === 'categorize' && (
                          <form className="grid grid-cols-12 gap-2 items-end" onSubmit={submitCategorize}>
                            <div className="col-span-4">
                              <Label>Cash account</Label>
                              <select
                                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                                value={action.cash_account_id}
                                onChange={e => setAction(a => (a ? { ...a, cash_account_id: e.target.value } : a))}
                                required
                              >
                                <option value="">Select cash account…</option>
                                {cashAccounts.map(a => (
                                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="col-span-4">
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
                            <div className="col-span-2">
                              <Label>Memo (optional)</Label>
                              <Input
                                value={action.memo}
                                onChange={e => setAction(a => (a ? { ...a, memo: e.target.value } : a))}
                                placeholder="JE memo override"
                              />
                            </div>
                            <div className="col-span-2 flex gap-2">
                              <Button type="submit" size="sm" disabled={busy || !action.cash_account_id || !action.offset_account_id}>Submit</Button>
                              <Button type="button" size="sm" variant="ghost" onClick={closeAction} disabled={busy}>Cancel</Button>
                            </div>
                          </form>
                        )}
                        {action.mode === 'exclude' && (
                          <form className="grid grid-cols-12 gap-2 items-end" onSubmit={submitExclude}>
                            <div className="col-span-9">
                              <Label>Reason</Label>
                              <textarea
                                className="min-h-[60px] w-full rounded-md border bg-background p-2 text-sm"
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
